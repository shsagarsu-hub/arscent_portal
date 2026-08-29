"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitPurchaseOrder } from "@/app/manager/purchase/actions";
import { stripPowerSpecs } from "@/lib/tally/matching";
import { workOrderNo } from "@/lib/orders/workOrderNo";
import {
  DEFAULT_TO,
  DEFAULT_CC,
  DEFAULT_REPLY_TO,
  DEFAULT_NOTES,
  DEFAULT_GST,
  DEFAULT_DELIVERY,
  DEFAULT_PAYMENT,
  DEFAULT_WARRANTY,
} from "./PurchaseOrderPanel";
import type { OrderDetail } from "./OrderDetailModal";

interface ResolvedLine {
  orderLineId: string;
  skuName: string;
  qty: number;
  itemId: string;
  itemName: string;
  unitPrice: string;
  resolved: boolean;
}

function parseEmails(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * "Raise PO" straight from an order -- resolves this order's own lines
 * against item_master (same official-name-in-notes matching
 * PurchaseOrderPanel's "Load from work order" uses) instead of making the
 * account manager retype the work order number into a separate screen, then
 * sends the PO exactly like that panel does. On success the order itself is
 * stamped with the resulting PO number and moved to "PO Raised" so its
 * lifecycle stays visible without a second lookup.
 */
export function RaisePoModal({ order, onClose, onDone }: { order: OrderDetail; onClose: () => void; onDone: () => void }) {
  const supabase = createClient();
  const [lines, setLines] = useState<ResolvedLine[] | null>(null);
  const [transferPriceSkus, setTransferPriceSkus] = useState<{ name: string; transfer_price: number }[]>([]);
  const [to, setTo] = useState(DEFAULT_TO);
  const [cc, setCc] = useState(DEFAULT_CC);
  const [replyTo, setReplyTo] = useState(DEFAULT_REPLY_TO);
  const [notes, setNotes] = useState(DEFAULT_NOTES);
  const [gstPercent, setGstPercent] = useState(DEFAULT_GST);
  const [delivery, setDelivery] = useState(DEFAULT_DELIVERY);
  const [payment, setPayment] = useState(DEFAULT_PAYMENT);
  const [warranty, setWarranty] = useState(DEFAULT_WARRANTY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("skus").select("name, transfer_price").not("transfer_price", "is", null).returns<{ name: string; transfer_price: number }[]>();
      setTransferPriceSkus(data ?? []);

      const resolved = await Promise.all(
        order.order_lines.map(async (l) => {
          const officialName = (l.notes ?? "").split(" — ")[0].trim();
          if (!officialName) return { orderLineId: l.id, skuName: l.skus?.name ?? "—", qty: l.qty, itemId: "", itemName: "", resolved: false };
          const { data: exact } = await supabase.from("item_master").select("id, name").eq("name", officialName).maybeSingle();
          if (exact) return { orderLineId: l.id, skuName: l.skus?.name ?? "—", qty: l.qty, itemId: exact.id, itemName: exact.name, resolved: true };
          const { data: fuzzy } = await supabase.from("item_master").select("id, name").ilike("name", `%${officialName}%`).limit(1).maybeSingle();
          if (fuzzy) return { orderLineId: l.id, skuName: l.skus?.name ?? "—", qty: l.qty, itemId: fuzzy.id, itemName: fuzzy.name, resolved: true };
          return { orderLineId: l.id, skuName: l.skus?.name ?? "—", qty: l.qty, itemId: "", itemName: officialName, resolved: false };
        })
      );
      setLines(
        resolved.map((r) => {
          const family = stripPowerSpecs(r.itemName || r.skuName)
            .trim()
            .toUpperCase();
          const match = (data ?? [])
            .filter((s) => family.includes(s.name.toUpperCase()))
            .sort((a, b) => b.name.length - a.name.length)[0];
          return { ...r, unitPrice: match ? String(match.transfer_price) : "" };
        })
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updatePrice(orderLineId: string, unitPrice: string) {
    setLines((prev) => (prev ? prev.map((l) => (l.orderLineId === orderLineId ? { ...l, unitPrice } : l)) : prev));
  }

  const allResolved = lines !== null && lines.every((l) => l.itemId);

  async function submit() {
    if (!lines) return;
    const toList = parseEmails(to);
    if (toList.length === 0) {
      setError("Add at least one To recipient.");
      return;
    }
    if (lines.some((l) => !l.itemId || l.qty <= 0 || !l.unitPrice.trim() || parseFloat(l.unitPrice) <= 0)) {
      setError("Every line needs a resolved catalog item and a unit price greater than 0.");
      return;
    }
    setSending(true);
    setError(null);
    const res = await submitPurchaseOrder({
      lines: lines.map((l) => ({ itemId: l.itemId, itemName: l.itemName, qty: l.qty, unitPrice: parseFloat(l.unitPrice), hsn: "" })),
      to: toList,
      cc: parseEmails(cc),
      replyTo,
      notes,
      gstPercent: parseFloat(gstPercent) || 0,
      delivery,
      payment,
      warranty,
    });
    if (!res.success) {
      setSending(false);
      setError(res.message);
      return;
    }
    // Stamp the order itself with the PO that now covers it.
    const { error: updateErr } = await supabase.from("orders").update({ status: "ordered", po_number: res.poNumber }).eq("id", order.id);
    setSending(false);
    if (updateErr) {
      setError(`PO ${res.poNumber} was sent, but the order couldn't be updated: ${updateErr.message}`);
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
        <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Raise a PO with Zeiss for this order</h3>
        <p className="mb-4 text-xs text-muted">
          {workOrderNo(order.id, order.created_at)} · {order.accounts?.label ?? "—"}
          {order.account_locations?.name ? ` (${order.account_locations.name})` : ""}. The PO number is generated automatically once
          sent.
        </p>

        {lines === null ? (
          <p className="text-xs text-muted">Resolving line items…</p>
        ) : (
          <div className="mb-4 space-y-2">
            {lines.map((l) => (
              <div key={l.orderLineId} className="rounded-[6px] border border-border p-2.5">
                <div className="mb-1 flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="font-semibold text-ink">
                    {l.itemName || l.skuName} <span className="text-muted">· Qty {l.qty}</span>
                  </span>
                  {!l.resolved && <span className="badge badge-watch">no catalog match — check name</span>}
                </div>
                <div className="w-[140px]">
                  <label className="field-label">Unit price (Rs.)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="field-input !py-1 text-[12.5px]"
                    value={l.unitPrice}
                    onChange={(e) => updatePrice(l.orderLineId, e.target.value)}
                  />
                </div>
              </div>
            ))}
            {!allResolved && (
              <p className="text-[11px] font-semibold text-watch-fg">
                Some lines couldn&apos;t be matched to a catalog item automatically — raise the PO from the Purchase tab instead so
                you can pick the item manually.
              </p>
            )}
          </div>
        )}

        <div className="mb-3 flex flex-wrap gap-3">
          <div className="w-[100px]">
            <label className="field-label">GST %</label>
            <input type="number" min={0} step="0.01" className="field-input" value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} />
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
            <input className="field-input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="min-w-[260px] flex-1">
            <label className="field-label">Cc</label>
            <input className="field-input" value={cc} onChange={(e) => setCc(e.target.value)} />
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

        {error && <p className="mb-3 text-xs font-semibold text-bad-fg">{error}</p>}

        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={sending || !lines || !allResolved} onClick={submit}>
            {sending ? "Sending…" : "Send PO to Zeiss"}
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
