"use client";

import { ORDER_TYPE_LABELS, ORDER_STATUS_LABELS } from "@/lib/orders/orderTypeLabels";
import { workOrderNo } from "@/lib/orders/workOrderNo";
import type { OrderStatus, OrderType } from "@/lib/supabase/database.types";

export interface OrderDetailLine {
  id: string;
  qty: number;
  net_price: number | null;
  notes: string | null;
  skus: { name: string } | null;
}

export interface OrderDetail {
  id: string;
  order_type: OrderType;
  status: OrderStatus;
  account_id: string;
  location_id: string;
  po_number: string | null;
  po_attachment_url: string | null;
  tracking_info: string | null;
  sales_invoice_url: string | null;
  requested_date: string | null;
  delivery_instruction: string | null;
  comment: string | null;
  created_at: string;
  order_lines: OrderDetailLine[];
  accounts?: { label: string } | null;
  account_locations?: { name: string } | null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className="text-[12.5px] text-ink-soft">{children}</div>
    </div>
  );
}

export function OrderDetailModal({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const total = order.order_lines.reduce((a, l) => a + l.qty * (l.net_price ?? 0), 0);

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[8px] bg-card p-5 shadow-[0_12px_32px_rgba(23,37,68,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-mono text-[15px] font-extrabold text-ink">{workOrderNo(order.id, order.created_at)}</h3>
            <p className="mt-0.5 text-xs text-muted">
              {ORDER_TYPE_LABELS[order.order_type]}
              {order.accounts ? ` — ${order.accounts.label}` : ""}
              {order.account_locations ? ` · ${order.account_locations.name}` : ""}
            </p>
          </div>
          <button type="button" className="shrink-0 text-lg leading-none text-muted hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Status">
            <span className="badge badge-neutral">{ORDER_STATUS_LABELS[order.status] ?? order.status}</span>
          </Field>
          <Field label="Requested Date">{order.requested_date ? new Date(order.requested_date).toLocaleDateString() : "—"}</Field>
          <Field label="PO Number">{order.po_number || "—"}</Field>
          <Field label="Delivery Instruction">{order.delivery_instruction || "—"}</Field>
          <Field label="Tracking Info">{order.tracking_info || "—"}</Field>
          <Field label="PO Attachment">
            {order.po_attachment_url ? (
              <a href={order.po_attachment_url} target="_blank" rel="noreferrer" className="font-bold text-brand hover:underline">
                View
              </a>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Sales Invoice">
            {order.sales_invoice_url ? (
              <a href={order.sales_invoice_url} target="_blank" rel="noreferrer" className="font-bold text-brand hover:underline">
                View
              </a>
            ) : (
              "—"
            )}
          </Field>
          <div className="col-span-2 sm:col-span-3">
            <Field label="Comment">{order.comment || "—"}</Field>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="u-table">
            <thead>
              <tr>
                <th>Family (Vs Committed)</th>
                <th>Official SKU / Note</th>
                <th>Qty</th>
                <th>Net Price</th>
              </tr>
            </thead>
            <tbody>
              {order.order_lines.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{l.skus?.name ?? "—"}</td>
                  <td className="max-w-[260px] text-[11.5px] text-muted">{l.notes ?? "—"}</td>
                  <td>{l.qty}</td>
                  <td>{l.net_price ?? "—"}</td>
                </tr>
              ))}
              {order.order_lines.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-xs text-muted">
                    No line items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-right text-[13px] font-extrabold text-ink">Total (ex GST): {total.toLocaleString("en-IN")}</p>
      </div>
    </div>
  );
}
