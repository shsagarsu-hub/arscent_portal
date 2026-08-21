"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppShell, Empty, Loading } from "./AppShell";
import { CommittedPanel } from "./CommittedPanel";
import { InventoryPanel } from "./InventoryPanel";
import { DashboardPanel } from "./DashboardPanel";
import { OrderDetailModal, type OrderDetail } from "./OrderDetailModal";
import { OrderFulfillmentModal } from "./OrderFulfillmentModal";
import { ConsignmentBillingPanel } from "./ConsignmentBillingPanel";
import { PurchaseOrderPanel } from "./PurchaseOrderPanel";
import { ReceivablesPanel } from "./ReceivablesPanel";
import { CommitmentAdjustmentsPanel } from "./CommitmentAdjustmentsPanel";
import { UndercommitmentAlerts } from "./UndercommitmentAlerts";
import { ExpiringStockAlert } from "./ExpiringStockAlert";
import { RevenueMarginPanel } from "./RevenueMarginPanel";
import { monthBounds, thisMonthISO } from "@/lib/dates";
import { ORDER_TYPE_LABELS } from "@/lib/orders/orderTypeLabels";
import { workOrderNo } from "@/lib/orders/workOrderNo";
import { sendOrderToConsignment } from "@/app/manager/orders/actions";
import { BoxIcon, BuildingIcon, ClipboardIcon, DashboardIcon, ReceiptIcon, TruckIcon, UploadIcon } from "./icons";

interface SkuRow {
  id: string;
  name: string;
  commitment_per_month: number | null;
  units_per_pack: number;
  account_id: string;
  accounts: { label: string; commitment_start: string | null } | null;
}

interface UsageRow {
  account_id: string;
  sku_id: string;
  location_id: string;
  qty: number;
  entry_date: string;
}

interface TallyLineRow {
  sku_id: string | null;
  account_id: string | null;
  qty: number;
  rate: number | null;
  invoice_date: string;
  invoice_no: string;
}

interface BilledConsignmentRow {
  sku_id: string;
  account_id: string | null;
  qty: number;
  amount: number | null;
  invoice_date: string | null;
}

interface BillingLineRow {
  order_line_id: string | null;
  status: string;
}

interface ClosedSaleableRow {
  account_id: string | null;
  invoice_date: string | null;
  invoice_number: string | null;
  order_lines: { sku_id: string; qty: number; net_price: number | null }[];
}

type OrderRow = OrderDetail;

export function ManagerPortal({ canManageAccounts }: { canManageAccounts: boolean }) {
  const supabase = createClient();

  const [months, setMonths] = useState<string[]>(() => [thisMonthISO()]);
  const [skus, setSkus] = useState<SkuRow[] | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [tallyLines, setTallyLines] = useState<TallyLineRow[] | null>(null);
  const [billedConsignment, setBilledConsignment] = useState<BilledConsignmentRow[] | null>(null);
  const [closedSaleable, setClosedSaleable] = useState<ClosedSaleableRow[] | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [sentLineIds, setSentLineIds] = useState<Set<string>>(new Set());
  const [sendingOrderId, setSendingOrderId] = useState<string | null>(null);
  const [fulfilling, setFulfilling] = useState<{ order: OrderRow; mode: "dc" | "invoice" } | null>(null);

  const load = useCallback(async () => {
    // months may be a non-contiguous set (e.g. Jun + Aug, skipping Jul), so
    // the DB query widens to the full span across every selected month and
    // the exact set is applied client-side below -- gte/lt alone can't
    // express "any of these specific months" in one round trip.
    const sortedMonths = months.slice().sort();
    const start = monthBounds(sortedMonths[0]).start;
    const end = monthBounds(sortedMonths[sortedMonths.length - 1]).end;
    const monthSet = new Set(months);
    const inSelectedMonths = (dateISO: string | null) => !!dateISO && monthSet.has(dateISO.slice(0, 7));

    const [
      { data: skuRows },
      { data: usageRows },
      { data: tallyRows },
      { data: billedRows },
      { data: closedSaleableRows },
      { data: orderRows },
      { data: billingLineRows },
    ] = await Promise.all([
      supabase
        .from("skus")
        .select("id, name, commitment_per_month, units_per_pack, account_id, accounts(label, commitment_start)")
        .order("name")
        .returns<SkuRow[]>(),
      supabase
        .from("usage_log")
        .select("account_id, sku_id, location_id, qty, entry_date")
        .gte("entry_date", start)
        .lt("entry_date", end)
        .returns<UsageRow[]>(),
      // Vs Committed's Actual comes from confirmed Tally invoice lines, not
      // hospital-reported usage_log (still fetched above, but only for the
      // "Centers Reporting" activity stat now) -- plus, below, consignment
      // usage that's been billed (its own invoice number/date, not a Tally
      // import) and closed Saleable orders (invoiced directly on the order),
      // both keyed the same way by invoice_date.
      // document_type = 'invoice' excludes credit/debit note rows -- their
      // qty is a fixed 1 (a ledger-line placeholder, not a real physical
      // unit; see parsePdf.ts), so counting them here would misrepresent
      // units actually sold against the monthly commitment target. They
      // still correctly affect revenue -- see Dashboard, which sums
      // qty * rate with no such filter, letting the signed rate net them in.
      supabase
        .from("tally_invoice_lines")
        .select("sku_id, account_id, qty, rate, invoice_date, invoice_no")
        .eq("document_type", "invoice")
        .gte("invoice_date", start)
        .lt("invoice_date", end)
        .returns<TallyLineRow[]>(),
      supabase
        .from("billing_requests")
        .select("sku_id, account_id, qty, amount, invoice_date")
        .eq("status", "billed")
        .gte("invoice_date", start)
        .lt("invoice_date", end)
        .returns<BilledConsignmentRow[]>(),
      supabase
        .from("orders")
        .select("account_id, invoice_date, invoice_number, order_lines(sku_id, qty, net_price)")
        .eq("order_type", "saleable")
        .eq("status", "closed")
        .gte("invoice_date", start)
        .lt("invoice_date", end)
        .returns<ClosedSaleableRow[]>(),
      supabase
        .from("orders")
        .select(
          "id, order_type, status, account_id, location_id, po_number, po_attachment_url, requested_date, delivery_instruction, comment, created_at, accounts(label), account_locations(name), order_lines(id, qty, net_price, notes, skus(name))"
        )
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<OrderRow[]>(),
      supabase.from("billing_requests").select("order_line_id, status").not("order_line_id", "is", null).returns<BillingLineRow[]>(),
    ]);

    setSkus(skuRows ?? []);
    setUsage((usageRows ?? []).filter((u) => inSelectedMonths(u.entry_date)));
    setTallyLines((tallyRows ?? []).filter((t) => inSelectedMonths(t.invoice_date)));
    setBilledConsignment((billedRows ?? []).filter((b) => inSelectedMonths(b.invoice_date)));
    setClosedSaleable((closedSaleableRows ?? []).filter((o) => inSelectedMonths(o.invoice_date)));
    setOrders(orderRows ?? []);
    setSentLineIds(new Set((billingLineRows ?? []).map((b) => b.order_line_id as string)));
  }, [months, supabase]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function deleteOrder(o: OrderRow, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete order ${workOrderNo(o.id, o.created_at)}? This removes its line items too and can't be undone.`)) {
      return;
    }
    setDeletingOrderId(o.id);
    const { error } = await supabase.from("orders").delete().eq("id", o.id);
    setDeletingOrderId(null);
    if (error) {
      // 23503 = foreign key violation -- at least one line has already been
      // sent to Consignment, so billing_requests still references it. Same
      // "fail loudly, don't cascade away billed history" pattern as deleteSku.
      if (error.code === "23503") {
        alert(
          "Can't delete this order — it's already in the Consignment pipeline. Delete its entries there first if you need to undo it."
        );
      } else {
        alert("Couldn't delete the order: " + error.message);
      }
      return;
    }
    if (selectedOrder?.id === o.id) setSelectedOrder(null);
    load();
  }

  async function sendToConsignment(o: OrderRow, e: React.MouseEvent) {
    e.stopPropagation();
    if (
      !confirm(
        `Send ${workOrderNo(o.id, o.created_at)} to Consignment? This creates a pending entry in Consignment's Usage Log for each of its ${o.order_lines.length} line item(s), ready to Record.`
      )
    ) {
      return;
    }
    setSendingOrderId(o.id);
    const res = await sendOrderToConsignment(o.id);
    setSendingOrderId(null);
    if (!res.success) {
      alert("Couldn't send to consignment: " + res.message);
      return;
    }
    load();
  }

  async function updateCommitment(skuId: string, value: string) {
    const parsed = value.trim() === "" ? null : parseInt(value, 10);
    setSavingKey(skuId);
    await supabase.from("skus").update({ commitment_per_month: parsed }).eq("id", skuId);
    setSavingKey(null);
    load();
  }

  if (
    skus === null ||
    usage === null ||
    tallyLines === null ||
    billedConsignment === null ||
    closedSaleable === null ||
    orders === null
  ) {
    return (
      <AppShell
        ctx="Account Manager"
        showUserName
        stats={[]}
        tabs={[{ id: "loading", label: "Loading", content: <Loading /> }]}
        maxWidthClass="max-w-[1400px]"
      />
    );
  }

  // Keyed by account_id + sku_id together, not sku_id alone -- a Tally
  // description can fuzzy-match a similarly-named SKU that belongs to a
  // DIFFERENT account (confirmed on a real invoice: Rajajinagar's "Treatment
  // Licence Smile Pro" matched Bommasandra's unrelated "SMILE (Treatment)"
  // SKU). matchSku now prefers the invoiced account's own catalog first
  // (see matching.ts), but this keeps a bad sku_id -- from a past import, a
  // manual override, or any future matching miss -- from crediting a
  // commitment target that account never actually sold against.
  // Only counts qty from revenue-bearing lines (rate/amount/net_price > 0)
  // -- confirmed on real invoices (SMILE Pro / FLAP) that a $0-rate line is
  // a duplicate stock-tracking entry for the SAME procedures already billed
  // on a paired Licence line, not additional units sold. Counting both
  // toward achievement roughly doubled it for those two products.
  const actualBySku = new Map<string, number>();
  function addActual(accountId: string | null, skuId: string | null, qty: number, revenue: number) {
    if (!accountId || !skuId || revenue <= 0) return;
    const key = `${accountId}|${skuId}`;
    actualBySku.set(key, (actualBySku.get(key) ?? 0) + (qty || 0));
  }
  tallyLines.forEach((t) => addActual(t.account_id, t.sku_id, t.qty, t.qty * (t.rate ?? 0)));
  billedConsignment.forEach((b) => addActual(b.account_id, b.sku_id, b.qty, b.amount ?? 0));
  // A closed saleable order whose invoice_number matches one already in
  // tally_invoice_lines is the same sale recorded twice (e.g. an order
  // backfilled to match a historical Tally import) -- Tally is authoritative,
  // so skip it here rather than double-count toward the commitment target.
  const tallyInvoiceNos = new Set(tallyLines.map((t) => t.invoice_no));
  closedSaleable
    .filter((o) => !(o.invoice_number && tallyInvoiceNos.has(o.invoice_number)))
    .forEach((o) => o.order_lines.forEach((l) => addActual(o.account_id, l.sku_id, l.qty, l.qty * (l.net_price ?? 0))));

  const centersReporting = new Set(usage.map((u) => `${u.account_id}|${u.location_id}`)).size;
  // How many of the selected months actually count toward this SKU's
  // target -- same logic CommittedPanel/RevenueMarginPanel already use.
  // Without this, the target stayed a single month's commitment while
  // actual summed every selected month, so selecting a wider range (e.g.
  // "12 months") inflated every ratio by up to 12x -- confirmed live: a
  // product committed at 2/month with 6 actual over a 12-month window read
  // as 300% instead of the correct ~25%.
  function eligibleMonthCount(commitmentStart: string | null) {
    const eligible = commitmentStart ? months.filter((m) => m >= commitmentStart.slice(0, 7)) : months;
    return eligible.length || 1;
  }
  // actualBySku is in raw invoice-line units (e.g. "packs"); commitment_per_
  // month is quoted per single procedure/unit, same granularity as
  // price_ex_gst/transfer_price, so it needs the same units_per_pack
  // conversion RevenueMarginPanel applies before comparing against target.
  const achievements = skus
    .filter((s) => s.commitment_per_month)
    .map((s) => {
      const monthCount = eligibleMonthCount(s.accounts?.commitment_start ?? null);
      const actual = (actualBySku.get(`${s.account_id}|${s.id}`) ?? 0) * (s.units_per_pack || 1);
      return actual / ((s.commitment_per_month as number) * monthCount);
    });
  const avgAch = achievements.length
    ? Math.round((achievements.reduce((a, b) => a + b, 0) / achievements.length) * 100)
    : null;

  return (
    <AppShell
      ctx="Account Manager"
      showUserName
      maxWidthClass="max-w-[1400px]"
      stats={[
        { value: centersReporting, label: "Centers Reporting" },
        { value: skus.length, label: "Products Tracked" },
        { value: avgAch === null ? "—" : `${avgAch}%`, label: "Avg Achievement" },
      ]}
      extraNav={
        canManageAccounts
          ? [
              { href: "/accounts", label: "Accounts", icon: <BuildingIcon /> },
              { href: "/manager/import", label: "Import", icon: <UploadIcon /> },
            ]
          : undefined
      }
      tabs={[
        {
          id: "dashboard",
          label: "Dashboard",
          icon: <DashboardIcon />,
          content: (
            <div className="space-y-4">
              <UndercommitmentAlerts />
              <ExpiringStockAlert />
              <DashboardPanel />
              <RevenueMarginPanel />
              <CommittedPanel
                skus={skus}
                actualBySku={actualBySku}
                months={months}
                setMonths={setMonths}
                savingKey={savingKey}
                updateCommitment={updateCommitment}
              />
            </div>
          ),
        },
        {
          id: "inventory",
          label: "Inventory",
          icon: <BoxIcon />,
          content: <InventoryPanel />,
        },
        {
          id: "purchase",
          label: "Purchase",
          icon: <TruckIcon />,
          content: <PurchaseOrderPanel />,
        },
        {
          id: "receivables",
          label: "Receivables",
          icon: <ReceiptIcon />,
          content: <ReceivablesPanel />,
        },
        {
          id: "commitments",
          label: "Adjustments",
          icon: <ClipboardIcon />,
          content: <CommitmentAdjustmentsPanel />,
        },
        {
          id: "orders",
          label: "Orders",
          icon: <ClipboardIcon />,
          content: (
            <div className="card">
              <h3 className="mb-3.5 text-[14.5px] font-extrabold text-ink">Orders received</h3>
              {orders.length === 0 ? (
                <Empty title="No orders yet" body="Orders submitted through the Order Portal will show up here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="u-table">
                    <thead>
                      <tr>
                        <th>Work Order #</th>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Account</th>
                        <th>Location</th>
                        <th>PO Number</th>
                        <th>PO Attachment</th>
                        <th>Lines</th>
                        <th>Total (ex GST)</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => {
                        const total = o.order_lines.reduce((a, l) => a + l.qty * (l.net_price ?? 0), 0);
                        return (
                          <tr key={o.id} className="cursor-pointer hover:bg-cream" onClick={() => setSelectedOrder(o)}>
                            <td className="whitespace-nowrap font-mono text-[11.5px]">{workOrderNo(o.id, o.created_at)}</td>
                            <td>{new Date(o.created_at).toLocaleDateString()}</td>
                            <td>{ORDER_TYPE_LABELS[o.order_type]}</td>
                            <td>{o.accounts?.label ?? "—"}</td>
                            <td>{o.account_locations?.name ?? "—"}</td>
                            <td>{o.po_number || "—"}</td>
                            <td>
                              {o.po_attachment_url ? (
                                <a
                                  href={o.po_attachment_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-bold text-brand hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  View
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>{o.order_lines.length}</td>
                            <td>{total.toLocaleString("en-IN")}</td>
                            <td>
                              <span className={`badge ${o.status === "closed" ? "badge-good" : "badge-neutral"}`}>
                                {o.status}
                              </span>
                            </td>
                            <td className="whitespace-nowrap">
                              <div className="flex gap-1.5">
                                {(o.order_type === "long_term_consignment" || o.order_type === "short_term_consignment") &&
                                  o.status !== "cancelled" &&
                                  o.status !== "closed" && (
                                    <button
                                      type="button"
                                      className="btn-primary !px-2.5 !py-1 text-[11px]"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setFulfilling({ order: o, mode: "dc" });
                                      }}
                                    >
                                      Enter DC
                                    </button>
                                  )}
                                {o.order_type === "saleable" && o.status !== "cancelled" && o.status !== "closed" && (
                                  <button
                                    type="button"
                                    className="btn-primary !px-2.5 !py-1 text-[11px]"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFulfilling({ order: o, mode: "invoice" });
                                    }}
                                  >
                                    Submit
                                  </button>
                                )}
                                {(o.order_type === "long_term_consignment_consumption" ||
                                  o.order_type === "short_term_consignment_consumption") &&
                                  o.status !== "cancelled" &&
                                  !o.order_lines.some((l) => sentLineIds.has(l.id)) && (
                                    <button
                                      type="button"
                                      className="btn-primary !px-2.5 !py-1 text-[11px]"
                                      disabled={sendingOrderId === o.id}
                                      onClick={(e) => sendToConsignment(o, e)}
                                    >
                                      {sendingOrderId === o.id ? "Sending…" : "Send to Consignment"}
                                    </button>
                                  )}
                                <button
                                  type="button"
                                  className="btn-outline-danger !px-2.5 !py-1 text-[11px]"
                                  disabled={deletingOrderId === o.id}
                                  onClick={(e) => deleteOrder(o, e)}
                                >
                                  {deletingOrderId === o.id ? "Deleting…" : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
              {fulfilling && (
                <OrderFulfillmentModal
                  order={fulfilling.order}
                  mode={fulfilling.mode}
                  onClose={() => setFulfilling(null)}
                  onDone={load}
                />
              )}
            </div>
          ),
        },
        {
          id: "consignment",
          label: "Consignment",
          icon: <ReceiptIcon />,
          content: <ConsignmentBillingPanel />,
        },
      ]}
    />
  );
}
