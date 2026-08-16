import { createClient } from "@/lib/supabase/server";
import type { OrderType } from "@/lib/supabase/database.types";
import { ORDER_TYPE_LABELS as TYPE_LABELS } from "@/lib/orders/orderTypeLabels";

interface OrderRow {
  id: string;
  order_type: OrderType;
  status: string;
  po_number: string | null;
  created_at: string;
  accounts: { label: string } | null;
  account_locations: { name: string } | null;
  order_lines: { qty: number; net_price: number | null }[];
}

export default async function OrderEnquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select("id, order_type, status, po_number, created_at, accounts(label), account_locations(name), order_lines(qty, net_price)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (type) query = query.eq("order_type", type as OrderType);

  const { data: orders } = await query.returns<OrderRow[]>();

  return (
    <div>
      <h1 className="mb-1 text-xl font-extrabold text-ink">Order Enquiry</h1>
      <p className="mb-6 text-sm text-muted">
        {type ? `Filtered to ${TYPE_LABELS[type as OrderType] ?? type}.` : "Last 50 orders across every type."}
      </p>

      <div className="card">
        {!orders || orders.length === 0 ? (
          <p className="text-xs text-muted">No orders submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="u-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Account</th>
                  <th>Location</th>
                  <th>PO Number</th>
                  <th>Lines</th>
                  <th>Total (ex GST)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const total = o.order_lines.reduce((a, l) => a + l.qty * (l.net_price ?? 0), 0);
                  return (
                    <tr key={o.id}>
                      <td>{new Date(o.created_at).toLocaleDateString()}</td>
                      <td>{TYPE_LABELS[o.order_type]}</td>
                      <td>{o.accounts?.label ?? "—"}</td>
                      <td>{o.account_locations?.name ?? "—"}</td>
                      <td>{o.po_number || "—"}</td>
                      <td>{o.order_lines.length}</td>
                      <td>{total.toLocaleString("en-IN")}</td>
                      <td>
                        <span className="badge badge-neutral">{o.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
