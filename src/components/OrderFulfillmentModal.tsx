"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { todayISO } from "@/lib/dates";
import type { OrderDetail } from "./OrderDetailModal";
import type { MovementCategory } from "@/lib/supabase/database.types";

interface LineState {
  itemMasterId: string;
  itemName: string;
  batchNumber: string;
  warehouseBalance: number | null;
  checkingBalance: boolean;
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
  const [lines, setLines] = useState<Record<string, LineState>>(
    Object.fromEntries(
      order.order_lines.map((l) => [l.id, { itemMasterId: "", itemName: "", batchNumber: "", warehouseBalance: null, checkingBalance: false }])
    )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allReady = order.order_lines.every((l) => lines[l.id]?.itemMasterId && lines[l.id]?.batchNumber.trim());

  function updateLine(lineId: string, patch: Partial<LineState>) {
    setLines((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  async function pickItem(lineId: string, itemMasterId: string, itemName: string) {
    updateLine(lineId, { itemMasterId, itemName, warehouseBalance: null });
    if (!itemMasterId) return;
    updateLine(lineId, { checkingBalance: true });
    const { data } = await supabase.from("stock_balance").select("balance").eq("item_id", itemMasterId).maybeSingle();
    updateLine(lineId, { warehouseBalance: data?.balance ?? 0, checkingBalance: false });
  }

  async function submit() {
    if (!refNumber.trim() || !refDate) {
      setError(`Enter both a ${mode === "dc" ? "DC" : "Invoice"} number and date.`);
      return;
    }
    if (!allReady) {
      setError("Confirm the exact catalog item and batch for every line first.");
      return;
    }
    setSaving(true);
    setError(null);

    const category: MovementCategory = mode === "dc" ? "dc_out" : "sale_out";
    const noteLabel = mode === "dc" ? "DC" : "Invoice";
    const movements = order.order_lines.map((l) => ({
      item_id: lines[l.id].itemMasterId,
      category,
      qty: l.qty,
      hospital_account_id: mode === "dc" ? order.account_id : null,
      batch_number: lines[l.id].batchNumber.trim(),
      order_line_id: l.id,
      notes: `${noteLabel} ${refNumber.trim()} — order line ${l.id}`,
    }));

    const { error: moveErr } = await supabase.from("stock_movements").insert(movements);
    if (moveErr) {
      setSaving(false);
      setError("Couldn't log the stock movement: " + moveErr.message);
      return;
    }

    const orderUpdate =
      mode === "dc"
        ? { status: "closed" as const, dc_number: refNumber.trim(), dc_date: refDate }
        : { status: "closed" as const, invoice_number: refNumber.trim(), invoice_date: refDate };
    const { error: orderErr } = await supabase.from("orders").update(orderUpdate).eq("id", order.id);
    setSaving(false);
    if (orderErr) {
      setError("Stock was logged, but couldn't close the order: " + orderErr.message);
      return;
    }
    onDone();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[8px] bg-card p-5 shadow-[0_12px_32px_rgba(23,37,68,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">
          {mode === "dc" ? "Enter DC details" : "Enter invoice details"}
        </h3>
        <p className="mb-4 text-xs text-muted">
          {order.accounts?.label ?? "—"}
          {order.account_locations?.name ? ` (${order.account_locations.name})` : ""} · {order.order_lines.length} line
          item(s). Confirm the exact catalog item + batch for each line before submitting — this is what actually
          moves stock out of the warehouse{mode === "dc" ? " and into their consignment balance" : ""}.
        </p>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">{mode === "dc" ? "DC Number" : "Sales Invoice Number"}</label>
            <input className="field-input" value={refNumber} onChange={(e) => setRefNumber(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="field-label">{mode === "dc" ? "DC Date" : "Invoice Date"}</label>
            <input type="date" className="field-input" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
          </div>
        </div>

        <div className="mb-4 space-y-3">
          {order.order_lines.map((l) => {
            const state = lines[l.id];
            const short = state.warehouseBalance !== null && state.warehouseBalance < l.qty;
            return (
              <div key={l.id} className="rounded-[6px] border border-border p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="text-[12.5px] font-semibold text-ink">
                    {l.skus?.name ?? "—"} <span className="text-muted">· Qty {l.qty}</span>
                  </div>
                </div>
                {l.notes && <p className="mb-2 text-[11px] text-muted">{l.notes}</p>}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <ItemPicker
                    itemId={state.itemMasterId}
                    itemName={state.itemName}
                    onSelect={(id, name) => void pickItem(l.id, id, name)}
                  />
                  <input
                    className="field-input !py-1 text-[12px]"
                    placeholder="Batch number"
                    value={state.batchNumber}
                    onChange={(e) => updateLine(l.id, { batchNumber: e.target.value })}
                  />
                </div>
                {state.itemMasterId && (
                  <p className={`mt-1.5 text-[11px] font-semibold ${short ? "text-bad-fg" : "text-muted"}`}>
                    {state.checkingBalance
                      ? "Checking warehouse stock…"
                      : short
                        ? `Only ${state.warehouseBalance} in warehouse stock — short by ${l.qty - (state.warehouseBalance ?? 0)}. Log a Purchase In first if needed.`
                        : `${state.warehouseBalance} currently in warehouse stock.`}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="mb-3 text-xs font-semibold text-bad-fg">{error}</p>}

        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            {saving ? "Saving…" : "Submit"}
          </button>
          <button
            type="button"
            className="rounded-[4px] border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-ink-soft"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
