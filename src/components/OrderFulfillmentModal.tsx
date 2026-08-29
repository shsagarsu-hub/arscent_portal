"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { todayISO } from "@/lib/dates";
import type { OrderDetail } from "./OrderDetailModal";
import type { MovementCategory } from "@/lib/supabase/database.types";
import { getDefaultInvoiceRecipients, sendSalesInvoiceEmailAction } from "@/app/manager/orders/actions";

interface BatchOption {
  batch_number: string;
  balance: number;
  expiry_date: string | null;
}

interface LineState {
  itemMasterId: string;
  itemName: string;
  // One batch_number per physical unit -- purchase imports write a unique
  // batch_number per serial (qty always 1 per stock_movements row), so a
  // line with qty > 1 needs that many distinct batches selected, not one
  // batch carrying the whole qty. Defaults to the qty earliest-expiry
  // batches (batchOptions already arrives sorted that way) but stays
  // editable in case the manager wants a different serial to ship.
  selectedBatches: string[];
  warehouseBalance: number | null;
  checkingBalance: boolean;
  batchOptions: BatchOption[] | null;
  loadingBatches: boolean;
}

/** Same ilike-search-against-item_master pattern used in Inventory and
 * Consignment's Edit row -- the order only ever captured the generic SKU
 * family, never the exact diopter/power, so the manager confirms the real
 * catalog item here, at the point stock is actually leaving the warehouse. */
function ItemPicker({
  itemId,
  itemName,
  onSelect,
}: {
  itemId: string;
  itemName: string;
  onSelect: (id: string, name: string) => void;
}) {
  const supabase = createClient();
  const [query, setQuery] = useState(itemName);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);

  function handleChange(value: string) {
    setQuery(value);
    onSelect("", "");
    if (value.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    void (async () => {
      const { data } = await supabase.from("item_master").select("id, name").ilike("name", `%${value.trim()}%`).order("name").limit(20);
      setSuggestions(data ?? []);
      setOpen(true);
    })();
  }

  return (
    <div className="relative">
      <input
        className="field-input w-full !py-1 text-[12px]"
        placeholder="Search catalog…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-52 w-[260px] overflow-y-auto rounded-[4px] border border-border bg-card shadow-[0_4px_12px_rgba(23,37,68,0.12)]">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`block w-full px-3 py-2 text-left text-[12px] hover:bg-cream ${
                s.id === itemId ? "bg-[#eaf1fd] font-semibold text-brand" : "text-ink"
              }`}
              onMouseDown={() => {
                onSelect(s.id, s.name);
                setQuery(s.name);
                setOpen(false);
              }}
            >
              {s.name}
            </button>
          ))}
          {suggestions.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">No match.</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Fulfillment step for an order -- this is where stock actually leaves the
 * warehouse, not a billing event. Two modes, same mechanics:
 *
 * "dc"      -- Long/Short-Term Consignment orders. Enter a DC Number + Date;
 *              each line becomes a dc_out movement WITH hospital_account_id
 *              set, so it reduces Warehouse Stock and simultaneously adds to
 *              that hospital's own Consignment Stock balance (per
 *              consignment_balance's `where hospital_account_id is not null`
 *              filter). The order closes immediately -- billing for what's
 *              actually consumed happens later, separately, via Log Usage
 *              against this PO.
 *
 * "invoice" -- Saleable orders. Enter an Invoice Number + Date; each line
 *              becomes a sale_out movement WITHOUT hospital_account_id (an
 *              outright sale was never "on consignment" for anyone, so it
 *              must not appear in any hospital's consignment balance --
 *              stock_balance subtracts sale_out regardless, so Warehouse
 *              Stock still drops correctly). The order closes immediately.
 */
export function OrderFulfillmentModal({
  order,
  mode,
  onClose,
  onDone,
}: {
  order: OrderDetail;
  mode: "dc" | "invoice";
  onClose: () => void;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [refNumber, setRefNumber] = useState("");
  const [refDate, setRefDate] = useState(todayISO());
  const [trackingInfo, setTrackingInfo] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lines, setLines] = useState<Record<string, LineState>>(
    Object.fromEntries(
      order.order_lines.map((l) => [
        l.id,
        { itemMasterId: "", itemName: "", selectedBatches: [], warehouseBalance: null, checkingBalance: false, batchOptions: null, loadingBatches: false },
      ])
    )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shown after a successful invoice upload (mode "invoice" only) -- lets
  // the manager confirm/edit who the invoice email goes to before sending,
  // instead of it going out silently.
  const [closedOrderId, setClosedOrderId] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const allReady = order.order_lines.every((l) => lines[l.id]?.itemMasterId && lines[l.id]?.selectedBatches.length === l.qty);

  function updateLine(lineId: string, patch: Partial<LineState>) {
    setLines((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  function toggleBatch(lineId: string, batchNumber: string, qty: number) {
    setLines((prev) => {
      const cur = prev[lineId].selectedBatches;
      const next = cur.includes(batchNumber)
        ? cur.filter((b) => b !== batchNumber)
        : cur.length < qty
          ? [...cur, batchNumber]
          : cur; // already have enough serials selected -- ignore further picks until one is unchecked
      return { ...prev, [lineId]: { ...prev[lineId], selectedBatches: next } };
    });
  }

  async function pickItem(lineId: string, itemMasterId: string, itemName: string, qty: number) {
    updateLine(lineId, { itemMasterId, itemName, warehouseBalance: null, selectedBatches: [], batchOptions: null });
    if (!itemMasterId) return;
    updateLine(lineId, { checkingBalance: true, loadingBatches: true });
    const [{ data: balanceRow }, { data: batchRows }] = await Promise.all([
      supabase.from("stock_balance").select("balance").eq("item_id", itemMasterId).maybeSingle(),
      // Only batches actually in the warehouse right now, oldest expiry
      // first -- picking here is what should decide which batch physically
      // ships, not a manually-typed number that might not match what's on
      // the shelf.
      supabase
        .from("stock_balance_by_batch")
        .select("batch_number, balance, expiry_date")
        .eq("item_id", itemMasterId)
        .not("batch_number", "is", null)
        .gt("balance", 0)
        .order("expiry_date", { ascending: true, nullsFirst: false })
        .returns<BatchOption[]>(),
    ]);
    const options = batchRows ?? [];
    // Every purchase-in batch here carries qty 1 (one row per serial), so
    // pre-select the qty earliest-expiry serials as a FEFO default -- the
    // manager can still swap individual ones before submitting.
    updateLine(lineId, {
      warehouseBalance: balanceRow?.balance ?? 0,
      checkingBalance: false,
      batchOptions: options,
      loadingBatches: false,
      selectedBatches: options.slice(0, qty).map((b) => b.batch_number),
    });
  }

  async function submit() {
    if (mode === "dc") {
      if (!refNumber.trim() || !refDate) {
        setError("Enter both a DC number and date.");
        return;
      }
    } else {
      if (!invoiceFile) {
        setError("Upload the sales invoice.");
        return;
      }
      if (!refDate) {
        setError("Enter the invoice date.");
        return;
      }
    }
    if (!allReady) {
      setError("Confirm the exact catalog item and batch for every line first.");
      return;
    }
    setSaving(true);
    setError(null);

    let salesInvoiceUrl: string | null = null;
    if (mode === "invoice") {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", invoiceFile!);
      formData.append("kind", "sales");
      const res = await fetch("/api/manager/invoice-upload", { method: "POST", body: formData });
      const body = await res.json();
      setUploading(false);
      if (!res.ok) {
        setSaving(false);
        setError(`Couldn't upload the invoice: ${body.error ?? "unknown error"}`);
        return;
      }
      salesInvoiceUrl = body.url;
    }

    const category: MovementCategory = mode === "dc" ? "dc_out" : "sale_out";
    const noteLabel = mode === "dc" ? "DC" : "Invoice";
    const noteRef = mode === "dc" ? refNumber.trim() : (invoiceFile?.name ?? "");
    // One stock_movements row per selected serial (qty always 1) rather than
    // one row carrying the line's whole qty against a single batch_number --
    // each batch here IS one physical unit, so lumping qty onto one serial
    // would falsely zero out that one serial while leaving the other real
    // units still marked as sitting in the warehouse.
    const movements = order.order_lines.flatMap((l) => {
      const expiryByBatch = new Map((lines[l.id].batchOptions ?? []).map((b) => [b.batch_number, b.expiry_date]));
      return lines[l.id].selectedBatches.map((batch) => ({
        item_id: lines[l.id].itemMasterId,
        category,
        qty: 1,
        hospital_account_id: mode === "dc" ? order.account_id : null,
        batch_number: batch,
        expiry_date: expiryByBatch.get(batch) ?? null,
        order_line_id: l.id,
        notes: `${noteLabel} ${noteRef} — order line ${l.id}`,
      }));
    });

    const { error: moveErr } = await supabase.from("stock_movements").insert(movements);
    if (moveErr) {
      setSaving(false);
      setError("Couldn't log the stock movement: " + moveErr.message);
      return;
    }

    // DC = the goods leaving the warehouse for the hospital, not the order
    // being finished -- it now lands on "Sent to Hospital" (with whatever
    // tracking info was given) and the hospital confirms Delivered
    // themselves via the status dropdown. A Saleable order still closes
    // outright here since attaching its invoice IS the completing event.
    const orderUpdate =
      mode === "dc"
        ? { status: "sent_to_hospital" as const, dc_number: refNumber.trim(), dc_date: refDate, tracking_info: trackingInfo.trim() || null }
        : { status: "closed" as const, invoice_date: refDate, sales_invoice_url: salesInvoiceUrl };
    const { error: orderErr } = await supabase.from("orders").update(orderUpdate).eq("id", order.id);
    setSaving(false);
    if (orderErr) {
      setError("Stock was logged, but couldn't update the order: " + orderErr.message);
      return;
    }
    onDone();
    if (mode === "dc") {
      onClose();
      return;
    }
    // Invoice mode: don't close yet -- offer to email it, prefilled with
    // the hospital's own login(s) but editable before anything is sent.
    setClosedOrderId(order.id);
    const defaults = await getDefaultInvoiceRecipients(order.account_id, order.location_id);
    setEmailTo(defaults.success ? defaults.to.join(", ") : "");
  }

  async function sendInvoiceEmail() {
    if (!closedOrderId) return;
    const to = emailTo.split(",").map((s) => s.trim()).filter(Boolean);
    const cc = emailCc.split(",").map((s) => s.trim()).filter(Boolean);
    if (to.length === 0) {
      setEmailStatus({ ok: false, text: "Add at least one To recipient." });
      return;
    }
    setSendingEmail(true);
    setEmailStatus(null);
    const res = await sendSalesInvoiceEmailAction(closedOrderId, to, cc);
    setSendingEmail(false);
    if (!res.success) {
      setEmailStatus({ ok: false, text: res.message });
      return;
    }
    setEmailStatus({ ok: true, text: `Sent to ${res.recipients.join(", ")}.` });
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[8px] bg-card p-5 shadow-[0_12px_32px_rgba(23,37,68,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {closedOrderId ? (
          <>
            <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Send Invoice Email</h3>
            <p className="mb-4 text-xs text-muted">
              {order.accounts?.label ?? "—"}
              {order.account_locations?.name ? ` (${order.account_locations.name})` : ""} — invoice uploaded, order closed.
            </p>
            <div className="mb-3">
              <label className="field-label">To</label>
              <input className="field-input" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="name@example.com, name2@example.com" autoFocus />
            </div>
            <div className="mb-4">
              <label className="field-label">Cc</label>
              <input className="field-input" value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="Optional — comma-separated emails" />
            </div>
            {emailStatus && (
              <p className={`mb-3.5 text-[12.5px] font-semibold ${emailStatus.ok ? "text-good-fg" : "text-bad-fg"}`}>{emailStatus.text}</p>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn-primary" disabled={sendingEmail} onClick={sendInvoiceEmail}>
                {sendingEmail ? "Sending…" : "Send Invoice Email"}
              </button>
              <button
                type="button"
                className="rounded-[4px] border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-ink-soft"
                onClick={onClose}
              >
                {emailStatus?.ok ? "Close" : "Skip"}
              </button>
            </div>
          </>
        ) : (
          <>
        <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">
          {mode === "dc" ? "Enter DC details" : "Enter invoice details"}
        </h3>
        <p className="mb-4 text-xs text-muted">
          {order.accounts?.label ?? "—"}
          {order.account_locations?.name ? ` (${order.account_locations.name})` : ""} · {order.order_lines.length} line
          item(s).
        </p>

        {mode === "dc" ? (
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div>
              <label className="field-label">DC Number</label>
              <input className="field-input" value={refNumber} onChange={(e) => setRefNumber(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="field-label">DC Date</label>
              <input type="date" className="field-input" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Tracking # / Courier (optional)</label>
              <input className="field-input" value={trackingInfo} onChange={(e) => setTrackingInfo(e.target.value)} placeholder="e.g. Bluedart 123456" />
            </div>
          </div>
        ) : (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Sales Invoice</label>
              <input
                type="file"
                accept="application/pdf,image/*"
                className="field-input file:mr-2 file:rounded-[3px] file:border-0 file:bg-brand file:px-2 file:py-1 file:text-[11px] file:font-bold file:text-white"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div>
              <label className="field-label">Invoice Date</label>
              <input type="date" className="field-input" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
            </div>
          </div>
        )}

        <div className="mb-4 space-y-3">
          {order.order_lines.map((l) => {
            const state = lines[l.id];
            const availableSerials = state.batchOptions?.length ?? 0;
            const short = state.batchOptions !== null && availableSerials < l.qty;
            return (
              <div key={l.id} className="rounded-[6px] border border-border p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="text-[12.5px] font-semibold text-ink">
                    {l.skus?.name ?? "—"} <span className="text-muted">· Qty {l.qty}</span>
                  </div>
                </div>
                {l.notes && <p className="mb-2 text-[11px] text-muted">{l.notes}</p>}
                <ItemPicker
                  itemId={state.itemMasterId}
                  itemName={state.itemName}
                  onSelect={(id, name) => void pickItem(l.id, id, name, l.qty)}
                />
                {state.itemMasterId && (
                  <div className="mt-2">
                    <p className="mb-1 text-[11px] font-semibold text-ink-soft">
                      Serials shipping ({state.selectedBatches.length} of {l.qty} selected)
                    </p>
                    {state.loadingBatches ? (
                      <p className="text-[11px] text-muted">Loading batches…</p>
                    ) : availableSerials === 0 ? (
                      <p className="text-[11px] font-semibold text-bad-fg">No serials in warehouse stock for this item.</p>
                    ) : (
                      <div className="max-h-40 overflow-y-auto rounded-[4px] border border-border">
                        {(state.batchOptions ?? []).map((b) => {
                          const checked = state.selectedBatches.includes(b.batch_number);
                          return (
                            <label
                              key={b.batch_number}
                              className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1 text-[11.5px] last:border-b-0 hover:bg-cream"
                            >
                              <input type="checkbox" checked={checked} onChange={() => toggleBatch(l.id, b.batch_number, l.qty)} />
                              <span className="font-mono">{b.batch_number}</span>
                              {b.expiry_date && <span className="text-muted">exp {b.expiry_date}</span>}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {state.itemMasterId && (
                  <p className={`mt-1.5 text-[11px] font-semibold ${short ? "text-bad-fg" : "text-muted"}`}>
                    {state.checkingBalance
                      ? "Checking warehouse stock…"
                      : short
                        ? `Only ${availableSerials} serial(s) in warehouse stock — short by ${l.qty - availableSerials}. Log a Purchase In first if needed.`
                        : `${availableSerials} serial(s) available in warehouse stock.`}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="mb-3 text-xs font-semibold text-bad-fg">{error}</p>}

        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            {uploading ? "Uploading…" : saving ? "Saving…" : "Submit"}
          </button>
          <button
            type="button"
            className="rounded-[4px] border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-ink-soft"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
