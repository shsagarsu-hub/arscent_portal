"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "./AppShell";
import { submitPurchaseOrder } from "@/app/manager/purchase/actions";
import { stripPowerSpecs } from "@/lib/tally/matching";
import { workOrderNo } from "@/lib/orders/workOrderNo";

// Arscent's standing Zeiss PO contacts, editable per send -- every PO to
// date has gone to this same distribution list (see the "Arscent PO #15 &
// 16" email thread), so prefilling it is a real time-save, not a guess.
export const DEFAULT_TO = "sagar.manjunath.ext@zeiss.com, prashanth.pakkirappa.ext@zeiss.com, sunil.anjinappa@zeiss.com";
export const DEFAULT_CC = "keshav@arraymed.co.in, sathish.l@zeiss.com, siddharth.prakash@zeiss.com";
export const DEFAULT_REPLY_TO = "sales.arscent@gmail.com";
export const DEFAULT_NOTES = "Please find the attached PO & Kindly do the needful.";
export const DEFAULT_GST = "5";
export const DEFAULT_DELIVERY = "Immediate";
export const DEFAULT_PAYMENT = "60 Days Credit";
export const DEFAULT_WARRANTY = "NA";

interface ItemSuggestion {
  id: string;
  name: string;
}

interface Line {
  key: string;
  itemId: string;
  itemName: string;
  qty: string;
  unitPrice: string;
  hsn: string;
}

function emptyLine(): Line {
  return { key: Math.random().toString(36).slice(2), itemId: "", itemName: "", qty: "1", unitPrice: "", hsn: "" };
}

function parseEmails(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Same debounced ilike-against-item_master combobox as Inventory's "Log a
 * movement" form and the order fulfillment modal -- the catalog runs into
 * the thousands, so it's never loaded in full. Also carries Inventory's
 * "no match -- add it" fallback: a PO can be the first time Arscent ever
 * orders a given lens power, so the catalog genuinely won't have it yet. */
function ItemPicker({
  itemId,
  itemName,
  onSelect,
  onCreate,
}: {
  itemId: string;
  itemName: string;
  onSelect: (id: string, name: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const supabase = createClient();
  const [query, setQuery] = useState(itemName);
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prevItemName, setPrevItemName] = useState(itemName);
  if (itemName !== prevItemName) {
    setPrevItemName(itemName);
    setQuery(itemName);
  }

  function handleChange(value: string) {
    setQuery(value);
    onSelect("", "");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase.from("item_master").select("id, name").ilike("name", `%${value.trim()}%`).order("name").limit(25);
      setSuggestions(data ?? []);
      setOpen(true);
    }, 250);
  }

  async function handleCreate() {
    setCreating(true);
    await onCreate(query.trim());
    setCreating(false);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        className="field-input !py-1 text-[12.5px]"
        placeholder="Search catalog…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-[4px] border border-border bg-card shadow-[0_4px_12px_rgba(23,37,68,0.12)]">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`block w-full px-3 py-2 text-left text-[12.5px] hover:bg-cream ${
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
          {suggestions.length === 0 && (
            <div className="px-3 py-2 text-[12.5px] text-muted">
              No match.{" "}
              {query.trim().length >= 2 && (
                <button
                  type="button"
                  className="font-bold text-brand hover:underline"
                  onMouseDown={handleCreate}
                  disabled={creating}
                >
                  {creating ? "Adding…" : `+ Add "${query.trim()}" as a new item`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PurchaseOrderLineRow {
  id: string;
  item_name: string;
  qty: number;
}

interface PurchaseOrderRow {
  id: string;
  po_number: string;
  created_at: string;
  purchase_order_lines: PurchaseOrderLineRow[];
}

export function PurchaseOrderPanel() {
  const supabase = createClient();

  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [poNumber, setPoNumber] = useState("");
  const [to, setTo] = useState(DEFAULT_TO);
  const [cc, setCc] = useState(DEFAULT_CC);
  const [replyTo, setReplyTo] = useState(DEFAULT_REPLY_TO);
  const [notes, setNotes] = useState(DEFAULT_NOTES);
  const [gstPercent, setGstPercent] = useState(DEFAULT_GST);
  const [delivery, setDelivery] = useState(DEFAULT_DELIVERY);
  const [payment, setPayment] = useState(DEFAULT_PAYMENT);
  const [warranty, setWarranty] = useState(DEFAULT_WARRANTY);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [woInput, setWoInput] = useState("");
  const [woLoading, setWoLoading] = useState(false);
  const [woStatus, setWoStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [recent, setRecent] = useState<PurchaseOrderRow[] | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [expandedPo, setExpandedPo] = useState<string | null>(null);
  const [cancelingPo, setCancelingPo] = useState<string | null>(null);
  const [cancelStatus, setCancelStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // Loaded once -- the committed-SKU table is small (dozens of rows, not
  // thousands like item_master) -- and matched client-side in pickItem
  // rather than via .ilike(), because the match direction is the reverse of
  // what ilike can express: it's the ITEM's stripped family name that needs
  // to CONTAIN the short SKU name ("CT LUCIA" inside "ZEISS CT LUCIA 621P"),
  // not the other way round. `skus.name ILIKE '%ZEISS CT LUCIA 621P%'` can
  // only ever match a SKU name at least that long, and every real SKU name
  // is shorter than the item family it's supposed to match -- so it never
  // matched anything, in production or anywhere else.
  const [transferPriceSkus, setTransferPriceSkus] = useState<{ name: string; transfer_price: number }[]>([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("skus")
        .select("name, transfer_price")
        .not("transfer_price", "is", null)
        .returns<{ name: string; transfer_price: number }[]>();
      setTransferPriceSkus(data ?? []);
    })();
  }, [supabase]);

  const loadRecent = useCallback(async () => {
    const { data } = await supabase
      .from("purchase_orders")
      .select("id, po_number, created_at, purchase_order_lines(id, item_name, qty)")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<PurchaseOrderRow[]>();
    setRecent(data ?? []);
  }, [supabase]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  // Each purchase_orders row already IS one PO with its own lines -- no more
  // grouping-by-notes-prefix needed now that a PO is a real row instead of a
  // shared string tag on stock_movements.
  const poGroups = useMemo(
    () =>
      (recent ?? []).map((po) => ({
        id: po.id,
        poNumber: po.po_number,
        date: po.created_at,
        totalQty: po.purchase_order_lines.reduce((sum, l) => sum + l.qty, 0),
        lines: po.purchase_order_lines,
      })),
    [recent]
  );

  /**
   * Deletes the purchase_orders row (its lines cascade) -- this is just
   * record-keeping now, not a stock reversal, since raising a PO never
   * touched stock in the first place.
   */
  async function cancelPurchaseOrder(group: { id: string; poNumber: string; totalQty: number; lines: PurchaseOrderLineRow[] }) {
    if (
      !confirm(`Cancel PO ${group.poNumber}? This removes the record of this PO (${group.lines.length} line${group.lines.length === 1 ? "" : "s"}, qty ${group.totalQty}). This can't be undone.`)
    ) {
      return;
    }
    setCancelingPo(group.poNumber);
    setCancelStatus(null);
    const { error } = await supabase.from("purchase_orders").delete().eq("id", group.id);
    setCancelingPo(null);
    if (error) {
      setCancelStatus({ ok: false, text: `Couldn't cancel ${group.poNumber}: ${error.message}` });
      return;
    }
    setCancelStatus({ ok: true, text: `${group.poNumber} cancelled.` });
    await loadRecent();
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  // item_master is the full lens-power-specific catalog ("CT LUCIA 621P
  // TIP2.2 DPT 21.0"), while transfer_price -- what Zeiss actually charges
  // Arscent -- lives on the smaller committed-family skus table ("CT
  // LUCIA"), set in Accounts. Looking it up by the stripped family name
  // rather than by id is what bridges the two catalogs. Never overwrites a
  // price the AM already typed in for this line.
  async function pickItem(lineKey: string, itemId: string, itemName: string) {
    const currentLine = lines.find((l) => l.key === lineKey);
    updateLine(lineKey, { itemId, itemName });
    if (!itemId || (currentLine && currentLine.unitPrice.trim() !== "")) return;
    const family = stripPowerSpecs(itemName).trim().toUpperCase();
    if (family.length < 3) return;
    // Longest matching SKU name wins, so a short, generic name (if one ever
    // exists) can't shadow a more specific one that also matches.
    const match = transferPriceSkus
      .filter((s) => family.includes(s.name.toUpperCase()))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (match) {
      updateLine(lineKey, { unitPrice: String(match.transfer_price) });
    }
  }

  // Same inline-create pattern as Inventory's "Log a movement" -- a PO can
  // legitimately be the first time Arscent orders a given lens power, so
  // the catalog won't have it yet.
  async function createItem(lineKey: string, name: string) {
    if (!name) return;
    const gtin = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    const { data, error } = await supabase.from("item_master").insert({ name, gtin }).select("id").single();
    if (!error && data) {
      updateLine(lineKey, { itemId: data.id, itemName: name });
    }
  }

  // Work order numbers aren't a stored column -- they're computed from the
  // order's id + created_at (see workOrderNo) -- so "looking one up" means
  // fetching candidate orders and recomputing the same formatted string for
  // each until one matches what the AM typed. A hospital's order_lines only
  // carry the generic committed sku on sku_id; the actual lens-power-specific
  // item_master name the hospital picked lives inside notes as
  // "<official item name>" or "<official item name> — <free note>" (see
  // HospitalOrderForm's submit), so resolving a real purchasable item means
  // parsing that back out and re-matching it against item_master by name.
  async function loadFromWorkOrder() {
    const target = woInput.trim().toUpperCase();
    if (!target) return;
    setWoLoading(true);
    setWoStatus(null);
    try {
      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, created_at, order_lines(qty, notes)")
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<{ id: string; created_at: string; order_lines: { qty: number; notes: string | null }[] }[]>();
      if (error) throw new Error(error.message);

      const match = (orders ?? []).find((o) => workOrderNo(o.id, o.created_at) === target);
      if (!match) {
        setWoStatus({ ok: false, text: `No order found with work order number ${target}.` });
        return;
      }
      if (match.order_lines.length === 0) {
        setWoStatus({ ok: false, text: `${target} has no line items to load.` });
        return;
      }

      const resolved = await Promise.all(
        match.order_lines.map(async (ol) => {
          const officialName = (ol.notes ?? "").split(" — ")[0].trim();
          if (!officialName) return { qty: ol.qty, itemId: "", itemName: "", resolved: false };
          const { data: exact } = await supabase.from("item_master").select("id, name").eq("name", officialName).maybeSingle();
          if (exact) return { qty: ol.qty, itemId: exact.id, itemName: exact.name, resolved: true };
          const { data: fuzzy } = await supabase
            .from("item_master")
            .select("id, name")
            .ilike("name", `%${officialName}%`)
            .limit(1)
            .maybeSingle();
          if (fuzzy) return { qty: ol.qty, itemId: fuzzy.id, itemName: fuzzy.name, resolved: true };
          return { qty: ol.qty, itemId: "", itemName: officialName, resolved: false };
        })
      );

      const newLines: Line[] = resolved.map((r) => ({
        key: Math.random().toString(36).slice(2),
        itemId: r.itemId,
        itemName: r.itemName,
        qty: String(r.qty),
        unitPrice: "",
        hsn: "",
      }));

      // Replace the still-untouched default single blank line rather than
      // appending after it, so loading a WO into a fresh form doesn't leave
      // a stray empty row above the real lines.
      const isUntouched = lines.length === 1 && !lines[0].itemId && !lines[0].itemName && lines[0].unitPrice.trim() === "";
      setLines(isUntouched ? newLines : [...lines, ...newLines]);

      newLines.forEach((nl) => {
        if (nl.itemId) void pickItem(nl.key, nl.itemId, nl.itemName);
      });

      const unresolvedCount = resolved.filter((r) => !r.resolved).length;
      setWoStatus({
        ok: true,
        text:
          `Loaded ${newLines.length} line${newLines.length === 1 ? "" : "s"} from ${target}.` +
          (unresolvedCount > 0
            ? ` ${unresolvedCount} need${unresolvedCount === 1 ? "s" : ""} a manual product match — search to confirm.`
            : ""),
      });
    } catch (err) {
      setWoStatus({ ok: false, text: err instanceof Error ? err.message : "Failed to load work order." });
    } finally {
      setWoLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const toList = parseEmails(to);
    const ccList = parseEmails(cc);
    const cleanedLines = lines
      .map((l) => ({ itemId: l.itemId, itemName: l.itemName, qty: parseInt(l.qty, 10), unitPrice: parseFloat(l.unitPrice), hsn: l.hsn }))
      .filter((l) => l.itemId && l.qty > 0 && l.unitPrice > 0);

    if (cleanedLines.length !== lines.length) {
      setStatus({ ok: false, text: "Every line needs a catalog item, a quantity, and a unit price greater than 0 — that's what fills in the attached PO's pricing." });
      return;
    }
    if (toList.length === 0) {
      setStatus({ ok: false, text: "Add at least one To recipient." });
      return;
    }

    setSending(true);
    setStatus(null);
    const res = await submitPurchaseOrder({
      lines: cleanedLines,
      to: toList,
      cc: ccList,
      replyTo,
      notes,
      gstPercent: parseFloat(gstPercent) || 0,
      delivery,
      payment,
      warranty,
      poNumber: poNumber.trim() || undefined,
    });
    setSending(false);

    if (!res.success) {
      setStatus({ ok: false, text: res.message });
      return;
    }
    const emailNote = res.email.sent
      ? "Email + PDF sent to Zeiss."
      : `PO recorded, but the email wasn't sent (${"reason" in res.email ? res.email.reason : res.email.error ?? "unknown reason"}).`;
    setStatus({ ok: true, text: `${res.poNumber} recorded. ${emailNote}` });
    setLines([emptyLine()]);
    setPoNumber("");
    setNotes(DEFAULT_NOTES);
    await loadRecent();
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-3.5 text-[14.5px] font-extrabold text-ink">Place a purchase order with Zeiss</h3>
        <form onSubmit={submit}>
          <div className="mb-3 max-w-xs">
            <label className="field-label">PO Number</label>
            <input
              className="field-input"
              placeholder="e.g. AR/IOLs/26-27/17 — leave blank to auto-generate"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
            />
            {recent && recent.length > 0 && (
              <p className="mt-1 text-[11px] text-muted">
                Last sent: <span className="font-mono">{recent[0].po_number}</span> on{" "}
                {new Date(recent[0].created_at).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="mb-3.5 rounded-[6px] border border-dashed border-border bg-cream p-2.5">
            <label className="field-label">Load line items from a work order</label>
            <div className="flex gap-2">
              <input
                className="field-input flex-1"
                placeholder="e.g. WO-20260812-4F2A9C"
                value={woInput}
                onChange={(e) => setWoInput(e.target.value)}
              />
              <button
                type="button"
                className="shrink-0 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs font-bold text-ink-soft disabled:opacity-50"
                disabled={woLoading || !woInput.trim()}
                onClick={() => void loadFromWorkOrder()}
              >
                {woLoading ? "Loading…" : "Load"}
              </button>
            </div>
            {woStatus && (
              <p className={`mt-1.5 text-[11.5px] font-semibold ${woStatus.ok ? "text-good-fg" : "text-bad-fg"}`}>{woStatus.text}</p>
            )}
          </div>
          <div className="mb-3 space-y-2">
            {lines.map((l, i) => (
              <div
                key={l.key}
                className="flex flex-col gap-2 rounded-[6px] border border-border p-2.5 sm:flex-row sm:items-start sm:border-0 sm:p-0"
              >
                <div className="sm:min-w-[200px] sm:flex-1">
                  <label className={`field-label ${i === 0 ? "" : "sm:hidden"}`}>Product</label>
                  <ItemPicker
                    itemId={l.itemId}
                    itemName={l.itemName}
                    onSelect={(id, name) => void pickItem(l.key, id, name)}
                    onCreate={(name) => createItem(l.key, name)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 sm:contents">
                  <div className="sm:w-[80px]">
                    <label className={`field-label ${i === 0 ? "" : "sm:hidden"}`}>Qty</label>
                    <input
                      type="number"
                      min={1}
                      className="field-input !py-1 text-[12.5px]"
                      value={l.qty}
                      onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                    />
                  </div>
                  <div className="sm:w-[120px]">
                    <label className={`field-label ${i === 0 ? "" : "sm:hidden"}`}>Unit price (Rs.)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="field-input !py-1 text-[12.5px]"
                      placeholder="0.00"
                      value={l.unitPrice}
                      onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                    />
                  </div>
                  <div className="sm:w-[100px]">
                    <label className={`field-label ${i === 0 ? "" : "sm:hidden"}`}>HSN (optional)</label>
                    <input
                      className="field-input !py-1 text-[12.5px]"
                      value={l.hsn}
                      onChange={(e) => updateLine(l.key, { hsn: e.target.value })}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className={`self-end rounded-[4px] border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-ink-soft sm:self-auto ${i === 0 ? "sm:mt-[22px]" : ""}`}
                  onClick={() => removeLine(l.key)}
                  disabled={lines.length === 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mb-4 rounded-[4px] border border-border bg-card px-3 py-1.5 text-xs font-bold text-ink-soft"
            onClick={addLine}
          >
            + Add product
          </button>

          <div className="mb-3 flex flex-wrap gap-3">
            <div className="w-[100px]">
              <label className="field-label">GST %</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className="field-input"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
              />
            </div>
            <div className="min-w-[160px] flex-1">
              <label className="field-label">Delivery</label>
              <input className="field-input" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
            </div>
            <div className="min-w-[160px] flex-1">
              <label className="field-label">Payment</label>
              <input className="field-input" value={payment} onChange={(e) => setPayment(e.target.value)} />
            </div>
            <div className="min-w-[140px] flex-1">
              <label className="field-label">Warranty</label>
              <input className="field-input" value={warranty} onChange={(e) => setWarranty(e.target.value)} />
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-3">
            <div className="min-w-[260px] flex-1">
              <label className="field-label">To</label>
              <input className="field-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@zeiss.com, name2@zeiss.com" />
            </div>
            <div className="min-w-[260px] flex-1">
              <label className="field-label">Cc</label>
              <input className="field-input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@example.com" />
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="field-label">Reply-To</label>
              <input className="field-input" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
            </div>
          </div>

          <div className="mb-4">
            <label className="field-label">Message (email body)</label>
            <textarea className="field-input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <button type="submit" className="btn-primary" disabled={sending}>
            {sending ? "Sending…" : "Send PO to Zeiss"}
          </button>
          {status && (
            <p className={`mt-2 text-xs font-semibold ${status.ok ? "text-good-fg" : "text-bad-fg"}`}>{status.text}</p>
          )}
        </form>
      </div>

      <div className="card">
        <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setRecentOpen((o) => !o)}>
          <div>
            <h3 className="text-[14.5px] font-extrabold text-ink">Recent purchase orders</h3>
          </div>
          <span className="ml-3 shrink-0 text-lg text-muted">{recentOpen ? "−" : "+"}</span>
        </button>
        {recentOpen && (
          <div className="mt-3.5">
            {cancelStatus && (
              <p className={`mb-2 text-xs font-semibold ${cancelStatus.ok ? "text-good-fg" : "text-bad-fg"}`}>{cancelStatus.text}</p>
            )}
            {recent === null ? (
              <Loading />
            ) : poGroups.length === 0 ? (
              <Empty title="No purchase orders sent yet" body="POs sent above will show up here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="u-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>PO Number</th>
                      <th>Lines</th>
                      <th>Total Qty</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {poGroups.map((g) => {
                      const isOpen = expandedPo === g.poNumber;
                      return (
                        <Fragment key={g.poNumber}>
                          <tr className="cursor-pointer hover:bg-cream" onClick={() => setExpandedPo(isOpen ? null : g.poNumber)}>
                            <td className="whitespace-nowrap">{new Date(g.date).toLocaleDateString()}</td>
                            <td className="whitespace-nowrap font-mono text-[11.5px]">
                              <span className="mr-1.5 text-muted">{isOpen ? "−" : "+"}</span>
                              {g.poNumber}
                            </td>
                            <td>{g.lines.length}</td>
                            <td>{g.totalQty}</td>
                            <td className="whitespace-nowrap">
                              <button
                                type="button"
                                className="btn-outline-danger !px-2.5 !py-1 text-[11px]"
                                disabled={cancelingPo === g.poNumber}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void cancelPurchaseOrder(g);
                                }}
                              >
                                {cancelingPo === g.poNumber ? "Cancelling…" : "Cancel PO"}
                              </button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={5} className="!p-0">
                                <div className="bg-[#f7f9fd] px-4 py-3">
                                  <table className="u-table">
                                    <thead>
                                      <tr>
                                        <th>Item</th>
                                        <th>Qty</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {g.lines.map((l) => (
                                        <tr key={l.id}>
                                          <td className="whitespace-nowrap">{l.item_name}</td>
                                          <td>{l.qty}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
