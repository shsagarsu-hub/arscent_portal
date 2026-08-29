"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SETTABLE_ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/orders/orderTypeLabels";
import type { OrderStatus } from "@/lib/supabase/database.types";

/** Manual status control for one order -- covers the plain tracking steps
 * (Submitted/Ordered/Received to Arscent/Sent to Hospital/Delivered/
 * Cancelled) that don't need a dedicated action of their own. "Closed" is
 * deliberately not offered here: it's only ever reached automatically (an
 * invoice attached, or every consignment usage line billed), never picked
 * by hand, so offering it here would let someone close an order without
 * the invoice that's supposed to gate it. Raising a PO and entering a DC
 * stay as their own buttons elsewhere since those carry real side effects
 * (an email to Zeiss, a stock movement) beyond just the status flip. */
export function OrderStatusDropdown({
  orderId,
  status,
  trackingInfo,
  onChanged,
}: {
  orderId: string;
  status: OrderStatus;
  trackingInfo: string | null;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);

  async function updateStatus(next: OrderStatus) {
    let tracking = trackingInfo;
    if (next === "sent_to_hospital" && !trackingInfo) {
      const entered = window.prompt("Tracking number or courier name for this shipment:");
      if (entered === null) return; // cancelled -- don't change status without it
      tracking = entered.trim() || null;
    }
    setSaving(true);
    const { error } = await supabase
      .from("orders")
      .update({ status: next, tracking_info: tracking })
      .eq("id", orderId);
    setSaving(false);
    if (error) {
      alert("Couldn't update status: " + error.message);
      return;
    }
    onChanged();
  }

  return (
    <div>
      <select
        className="rounded-[4px] border border-border bg-card px-1.5 py-1 text-[11px] font-bold text-ink-soft disabled:opacity-50"
        value={status}
        disabled={saving}
        onChange={(e) => void updateStatus(e.target.value as OrderStatus)}
      >
        {SETTABLE_ORDER_STATUSES.includes(status) ? null : <option value={status}>{ORDER_STATUS_LABELS[status]}</option>}
        {SETTABLE_ORDER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {ORDER_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {status === "sent_to_hospital" && trackingInfo && (
        <div className="mt-0.5 text-[10px] text-muted" title={trackingInfo}>
          {trackingInfo}
        </div>
      )}
    </div>
  );
}
