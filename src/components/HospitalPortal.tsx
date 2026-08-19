"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppShell, Empty, Loading } from "./AppShell";
import { HospitalOrderForm } from "./HospitalOrderForm";
import { HospitalReportPanel } from "./HospitalReportPanel";
import { OrderDetailModal, type OrderDetail } from "./OrderDetailModal";
import { fmtDate, monthBounds, thisMonthISO, todayISO } from "@/lib/dates";
import { ORDER_TYPE_LABELS } from "@/lib/orders/orderTypeLabels";
import { workOrderNo } from "@/lib/orders/workOrderNo";
import type { OrderType } from "@/lib/supabase/database.types";
import { CartIcon, ClockIcon, DashboardIcon, PencilIcon, ReceiptIcon } from "./icons";

// Teal, not blue -- gives the hospital side its own visual identity distinct
// from the account manager portal's brand-blue, via AppShell's accentColor.
const HOSPITAL_ACCENT = "#0e9488";

interface Sku {
  id: string;
  name: string;
  price_ex_gst: number | null;
}

interface HistoryRow {
  id: string;
  entry_date: string;
  qty: number;
  note: string | null;
  batch_number: string | null;
  skus: { name: string } | null;
  account_locations: { name: string } | null;
}

// One still-open line from a DC'd LTC/STC order -- this is what's actually
// sitting on consignment at the hospital, down to the exact shipment it
// arrived on (needed for FIFO draw-down and to trace billing back to the
// right PO/order-type when Send to Consignment runs later).
interface ConsignmentLine {
  id: string;
  orderId: string;
  orderType: OrderType;
  poNumber: string | null;
  dcDate: string | null;
  skuId: string;
  skuName: string;
  itemMasterId: string | null;
  itemName: string | null;
  suggestedBatch: string | null;
  netPrice: number | null;
  remaining: number;
}

// Consignment lines grouped by item for display -- a hospital doesn't care
// which shipment a unit arrived on, just "how much of this do I have".
interface ConsignmentItemRow {
  key: string;
  itemName: string;
  available: number;
}

const CONSUMPTION_TYPE: Record<string, OrderType> = {
  long_term_consignment: "long_term_consignment_consumption",
  short_term_consignment: "short_term_consignment_consumption",
};

type OrderRow = OrderDetail;

export function HospitalPortal({
  accountId,
  locationId,
  accountLabel,
  locationName,
  locations,
  skus,
  userId,
}: {
  accountId: string;
  locationId: string | null;
  accountLabel: string;
  locationName: string | null;
  locations: { id: string; name: string }[];
  skus: Sku[];
  userId: string;
}) {
  const supabase = createClient();

  // A fixed-location login (most hospitals) always logs/orders against
  // locationId. An account-wide login (one login covering every center
  // under a single commitment agreement, e.g. LVPEI) has locationId === null
  // -- the center is picked per entry instead, via this dropdown state.
  const multiCenter = locationId === null;
  const [logLocationId, setLogLocationId] = useState(locationId ?? locations[0]?.id ?? "");

  const [stats, setStats] = useState({ today: 0, month: 0, allTime: 0 });
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);

  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Everything a hospital could ever log usage for arrived on consignment
  // first -- there's no such thing as "ad-hoc" usage of a product that was
  // never shipped to them. So every item still on hand is looked up
  // automatically (see loadConsignmentLines) and listed with how much
  // remains; the hospital just edits a qty against whatever they used.
  const [consignmentLines, setConsignmentLines] = useState<ConsignmentLine[] | null>(null);
  // One qty per item, keyed by item_master_id (or sku_id when there's no
  // catalog item on record) -- draw-down across the underlying shipments is
  // resolved FIFO at submit time (see submitLog).
  const [consignmentQty, setConsignmentQty] = useState<Record<string, string>>({});

  const loadStats = useCallback(async () => {
    const today = todayISO();
    const { start, end } = monthBounds(thisMonthISO());

    let todayQ = supabase.from("usage_log").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("entry_date", today);
    let monthQ = supabase.from("usage_log").select("qty").eq("account_id", accountId).gte("entry_date", start).lt("entry_date", end);
    let allQ = supabase.from("usage_log").select("qty").eq("account_id", accountId);
    if (locationId) {
      todayQ = todayQ.eq("location_id", locationId);
      monthQ = monthQ.eq("location_id", locationId);
      allQ = allQ.eq("location_id", locationId);
    }

    const [{ count: entriesToday }, { data: monthRows }, { data: allRows }] = await Promise.all([todayQ, monthQ, allQ]);

    setStats({
      today: entriesToday ?? 0,
      month: (monthRows ?? []).reduce((a, r) => a + (r.qty || 0), 0),
      allTime: (allRows ?? []).reduce((a, r) => a + (r.qty || 0), 0),
    });
  }, [accountId, locationId, supabase]);

  const loadHistory = useCallback(async () => {
    let q = supabase
      .from("usage_log")
      .select("id, entry_date, qty, note, batch_number, skus(name), account_locations(name)")
      .eq("account_id", accountId);
    if (locationId) q = q.eq("location_id", locationId);
    const { data } = await q.order("created_at", { ascending: false }).limit(30).returns<HistoryRow[]>();
    setHistory(data ?? []);
  }, [accountId, locationId, supabase]);

  const loadOrders = useCallback(async () => {
    let q = supabase
      .from("orders")
      .select(
        "id, order_type, status, account_id, location_id, po_number, po_attachment_url, requested_date, delivery_instruction, comment, created_at, order_lines(id, qty, net_price, notes, skus(name)), account_locations(name)"
      )
      .eq("account_id", accountId);
    if (locationId) q = q.eq("location_id", locationId);
    const { data } = await q.order("created_at", { ascending: false }).limit(50).returns<OrderRow[]>();
    setOrders(data ?? []);
  }, [accountId, locationId, supabase]);

  // Every still-open line from a DC'd LTC/STC order under this account --
  // consignment stock is tracked per-account, not per-center (stock_movements
  // has no location column), so this pools every shipment regardless of
  // which center placed the original order, matching how the manager's own
  // "Consignment by hospital" balance already works.
  const loadConsignmentLines = useCallback(async () => {
    const { data: matchedOrders } = await supabase
      .from("orders")
      .select("id, order_type, po_number, dc_date")
      .eq("account_id", accountId)
      .in("order_type", ["long_term_consignment", "short_term_consignment"])
      .not("dc_number", "is", null)
      .returns<{ id: string; order_type: OrderType; po_number: string | null; dc_date: string | null }[]>();

    if (!matchedOrders || matchedOrders.length === 0) {
      setConsignmentLines([]);
      return;
    }
    const orderById = new Map(matchedOrders.map((o) => [o.id, o]));
    const orderIds = matchedOrders.map((o) => o.id);

    const { data: origLines } = await supabase
      .from("order_lines")
      .select("id, order_id, sku_id, qty, net_price, skus(name)")
      .in("order_id", orderIds);
    const lineIds = (origLines ?? []).map((l) => l.id);
    if (lineIds.length === 0) {
      setConsignmentLines([]);
      return;
    }

    const [{ data: consumedRows }, { data: dcMovements }] = await Promise.all([
      supabase.from("order_lines").select("source_order_line_id, qty").in("source_order_line_id", lineIds),
      supabase
        .from("stock_movements")
        .select("order_line_id, item_id, batch_number, item_master(name)")
        .in("order_line_id", lineIds)
        .eq("category", "dc_out")
        .returns<{ order_line_id: string | null; item_id: string; batch_number: string | null; item_master: { name: string } | null }[]>(),
    ]);

    const usedByLine = new Map<string, number>();
    (consumedRows ?? []).forEach((r) => {
      if (!r.source_order_line_id) return;
      usedByLine.set(r.source_order_line_id, (usedByLine.get(r.source_order_line_id) ?? 0) + (r.qty || 0));
    });
    const dcByLine = new Map<string, { itemId: string; itemName: string; batch: string | null }>();
    (dcMovements ?? []).forEach((m) => {
      if (!m.order_line_id) return;
      dcByLine.set(m.order_line_id, { itemId: m.item_id, itemName: m.item_master?.name ?? "", batch: m.batch_number });
    });

    const lines: ConsignmentLine[] = (origLines ?? [])
      .map((l) => {
        const used = usedByLine.get(l.id) ?? 0;
        const dc = dcByLine.get(l.id);
        const order = orderById.get(l.order_id);
        return {
          id: l.id,
          orderId: l.order_id,
          orderType: order?.order_type ?? "long_term_consignment",
          poNumber: order?.po_number ?? null,
          dcDate: order?.dc_date ?? null,
          skuId: l.sku_id,
          skuName: l.skus?.name ?? "—",
          itemMasterId: dc?.itemId ?? null,
          itemName: dc?.itemName ?? null,
          suggestedBatch: dc?.batch ?? null,
          netPrice: l.net_price,
          remaining: l.qty - used,
        };
      })
      .filter((l) => l.remaining > 0);
    setConsignmentLines(lines);
  }, [accountId, supabase]);

  const consignmentRows = useMemo<ConsignmentItemRow[] | null>(() => {
    if (!consignmentLines) return null;
    const map = new Map<string, ConsignmentItemRow>();
    for (const l of consignmentLines) {
      const key = l.itemMasterId ?? l.skuId;
      const name = l.itemName || l.skuName;
      const existing = map.get(key);
      if (existing) existing.available += l.remaining;
      else map.set(key, { key, itemName: name, available: l.remaining });
    }
    return Array.from(map.values()).sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [consignmentLines]);

  function updateConsignmentQty(key: string, value: string) {
    setConsignmentQty((prev) => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    void (async () => {
      await Promise.all([loadStats(), loadHistory(), loadOrders(), loadConsignmentLines()]);
    })();
  }, [loadStats, loadHistory, loadOrders, loadConsignmentLines]);

  async function submitLog(e: React.FormEvent) {
    e.preventDefault();
    if (!date) {
      setMsg({ text: "Enter a date.", ok: false });
      return;
    }
    if (multiCenter && !logLocationId) {
      setMsg({ text: "Select which center this usage is for.", ok: false });
      return;
    }

    // Every item still on hand from consignment is listed at once (see the
    // table below); the hospital edits a qty against however many of each
    // they actually used, and this submits all of them together as one
    // batch. Draw-down against the underlying shipments (needed to keep
    // billing traceable back to the right PO/order) is resolved FIFO here,
    // oldest DC first, entirely behind the scenes.
    const entries = Object.entries(consignmentQty)
      .map(([key, v]) => ({ key, qtyNum: parseInt(v, 10) }))
      .filter((e) => e.qtyNum > 0);

    if (entries.length === 0) {
      setMsg({ text: "Enter a quantity for at least one item.", ok: false });
      return;
    }

    const rows: { line: ConsignmentLine; qtyNum: number }[] = [];
    for (const entry of entries) {
      const itemLines = (consignmentLines ?? [])
        .filter((l) => (l.itemMasterId ?? l.skuId) === entry.key)
        .slice()
        .sort((a, b) => (a.dcDate ?? "").localeCompare(b.dcDate ?? ""));
      const totalAvailable = itemLines.reduce((sum, l) => sum + l.remaining, 0);
      const itemName = itemLines[0]?.itemName || itemLines[0]?.skuName || "that item";
      if (entry.qtyNum > totalAvailable) {
        setMsg({ text: `Only ${totalAvailable} available for ${itemName}.`, ok: false });
        return;
      }
      let remainingToAllocate = entry.qtyNum;
      for (const line of itemLines) {
        if (remainingToAllocate <= 0) break;
        const take = Math.min(line.remaining, remainingToAllocate);
        if (take > 0) {
          rows.push({ line, qtyNum: take });
          remainingToAllocate -= take;
        }
      }
    }

    setSaving(true);
    setMsg(null);

    const noteFor = (r: (typeof rows)[number]) => {
      const label = r.line.itemName || r.line.skuName;
      return note.trim() ? `${label} — ${note.trim()}` : label;
    };

    const { error: usageErr } = await supabase.from("usage_log").insert(
      rows.map((r) => ({
        account_id: accountId,
        location_id: locationId ?? logLocationId,
        sku_id: r.line.skuId,
        item_master_id: r.line.itemMasterId || null,
        entry_date: date,
        qty: r.qtyNum,
        note: noteFor(r),
        batch_number: r.line.suggestedBatch ?? "",
        // The usage_log billing trigger skips creating its own
        // billing_requests row when this is set -- billing for these
        // entries runs through the consumption order below instead
        // (Orders -> Send to Consignment), not automatically.
        source_order_line_id: r.line.id,
        logged_by: userId,
      }))
    );
    if (usageErr) {
      setSaving(false);
      setMsg({ text: "Couldn't save — " + usageErr.message, ok: false });
      return;
    }

    // One consumption order per source order -- a single qty entered for
    // an item can draw from more than one DC shipment (oldest first), and
    // each shipment keeps its own PO number and order type.
    const groups = new Map<string, { orderType: OrderType; poNumber: string | null; rows: typeof rows }>();
    for (const r of rows) {
      const g = groups.get(r.line.orderId) ?? { orderType: r.line.orderType, poNumber: r.line.poNumber, rows: [] };
      g.rows.push(r);
      groups.set(r.line.orderId, g);
    }

    for (const group of groups.values()) {
      const consumptionType = CONSUMPTION_TYPE[group.orderType];
      if (!consumptionType) continue;
      const { data: consumptionOrder, error: orderErr } = await supabase
        .from("orders")
        .insert({
          order_type: consumptionType,
          account_id: accountId,
          location_id: locationId ?? logLocationId,
          po_number: group.poNumber,
          created_by: userId,
        })
        .select("id")
        .single();
      if (orderErr || !consumptionOrder) {
        setSaving(false);
        setMsg({ text: "Usage was logged, but couldn't create its billing record: " + (orderErr?.message ?? "unknown error"), ok: false });
        return;
      }
      const { error: lineErr } = await supabase.from("order_lines").insert(
        group.rows.map((r) => ({
          order_id: consumptionOrder.id,
          sku_id: r.line.skuId,
          qty: r.qtyNum,
          net_price: r.line.netPrice,
          notes: noteFor(r),
          source_order_line_id: r.line.id,
        }))
      );
      if (lineErr) {
        setSaving(false);
        setMsg({ text: "Usage was logged, but couldn't create its billing record: " + lineErr.message, ok: false });
        return;
      }
    }

    setSaving(false);
    setMsg({ text: `Logged ${rows.length} item(s).`, ok: true });
    setNote("");
    setConsignmentQty({});
    loadStats();
    loadHistory();
    loadConsignmentLines();
  }

  return (
    <AppShell
      ctx={locationName ? `${locationName} · ${accountLabel}` : accountLabel}
      maxWidthClass="max-w-[1400px]"
      accentColor={HOSPITAL_ACCENT}
      stats={[
        { value: stats.today, label: "Entries Today" },
        { value: stats.month, label: "Units This Month" },
        { value: stats.allTime, label: "Units All-Time" },
      ]}
      tabs={[
        {
          id: "report",
          label: "Report",
          icon: <DashboardIcon />,
          content: <HospitalReportPanel accountId={accountId} locationId={locationId} />,
        },
        {
          id: "log",
          label: "Log Usage",
          icon: <PencilIcon />,
          content: (
            <div className="card">
              <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Log usage</h3>
              <p className="mb-3.5 text-xs text-muted">
                Enter the quantity actually used for each consigned product below.
              </p>
              <form onSubmit={submitLog}>
                <div className="mb-3 flex flex-wrap gap-3">
                  <div className="min-w-[150px] flex-1">
                    <label className="field-label">Date</label>
                    <input
                      type="date"
                      className="field-input"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                  {multiCenter && (
                    <div className="min-w-[150px] flex-1">
                      <label className="field-label">Center</label>
                      <select
                        className="field-input"
                        value={logLocationId}
                        onChange={(e) => setLogLocationId(e.target.value)}
                      >
                        <option value="">Select…</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="mb-3">
                  <label className="field-label">Stock on consignment{locationName ? "" : ` — ${accountLabel}`}</label>
                  {consignmentRows === null ? (
                    <div className="field-input flex items-center text-[12.5px] text-muted">Loading…</div>
                  ) : consignmentRows.length === 0 ? (
                    <div className="field-input flex items-center text-[12.5px] text-muted">
                      Nothing currently on consignment — nothing to log usage against.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-[6px] border border-border">
                      <table className="u-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Available</th>
                            <th>Qty used</th>
                          </tr>
                        </thead>
                        <tbody>
                          {consignmentRows.map((row) => (
                            <tr key={row.key}>
                              <td>{row.itemName}</td>
                              <td>{row.available}</td>
                              <td>
                                <input
                                  type="number"
                                  min={0}
                                  max={row.available}
                                  step={1}
                                  className="field-input !py-1 w-24 text-[12px]"
                                  placeholder="0"
                                  value={consignmentQty[row.key] ?? ""}
                                  onChange={(e) => updateConsignmentQty(row.key, e.target.value)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="mb-3">
                  <label className="field-label">Note (optional)</label>
                  <input
                    type="text"
                    placeholder="patient case reference, notes"
                    className="field-input"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={saving || (multiCenter && !logLocationId)}
                >
                  {saving ? "Saving…" : "Save entry"}
                </button>
                {msg && (
                  <span
                    className={`ml-3 text-xs font-semibold ${msg.ok ? "text-good-fg" : "text-bad-fg"}`}
                  >
                    {msg.text}
                  </span>
                )}
              </form>
            </div>
          ),
        },
        {
          id: "history",
          label: "History",
          icon: <ClockIcon />,
          content: (
            <div className="card">
              <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">
                History{locationName ? ` — ${locationName}` : ""}
              </h3>
              <p className="mb-3.5 text-xs text-muted">
                {multiCenter ? "Most recent 30 entries across every center." : "Most recent 30 entries for this center."}
              </p>
              {history === null ? (
                <Loading />
              ) : history.length === 0 ? (
                <Empty title="Nothing logged yet" body="Entries for this center will show up here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="u-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        {multiCenter && <th>Center</th>}
                        <th>SKU</th>
                        <th>Batch</th>
                        <th>Qty</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((e) => (
                        <tr key={e.id}>
                          <td>{fmtDate(e.entry_date)}</td>
                          {multiCenter && <td>{e.account_locations?.name ?? "—"}</td>}
                          <td>{e.skus?.name ?? "—"}</td>
                          <td>{e.batch_number ?? "—"}</td>
                          <td>{e.qty}</td>
                          <td>{e.note || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ),
        },
        {
          id: "order",
          label: "Place Order",
          icon: <CartIcon />,
          content: (
            <HospitalOrderForm
              accountId={accountId}
              locationId={locationId}
              locations={locations}
              skus={skus}
              onSubmitted={loadOrders}
            />
          ),
        },
        {
          id: "orders",
          label: "My Orders",
          icon: <ReceiptIcon />,
          content: (
            <div className="card">
              <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">
                Orders{locationName ? ` — ${locationName}` : ""}
              </h3>
              <p className="mb-3.5 text-xs text-muted">Every order you&apos;ve placed, most recent first.</p>
              {orders === null ? (
                <Loading />
              ) : orders.length === 0 ? (
                <Empty title="No orders yet" body="Orders you place will show up here, along with their status." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="u-table">
                    <thead>
                      <tr>
                        <th>Work Order #</th>
                        <th>Date</th>
                        {multiCenter && <th>Center</th>}
                        <th>Type</th>
                        <th>PO Number</th>
                        <th>PO Attachment</th>
                        <th>Lines</th>
                        <th>Total (ex GST)</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => {
                        const total = o.order_lines.reduce((a, l) => a + l.qty * (l.net_price ?? 0), 0);
                        return (
                          <tr key={o.id} className="cursor-pointer hover:bg-cream" onClick={() => setSelectedOrder(o)}>
                            <td className="whitespace-nowrap font-mono text-[11.5px]">{workOrderNo(o.id, o.created_at)}</td>
                            <td>{new Date(o.created_at).toLocaleDateString()}</td>
                            {multiCenter && <td>{o.account_locations?.name ?? "—"}</td>}
                            <td>{ORDER_TYPE_LABELS[o.order_type]}</td>
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
                              <span className="badge badge-neutral">{o.status}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
            </div>
          ),
        },
      ]}
    />
  );
}
