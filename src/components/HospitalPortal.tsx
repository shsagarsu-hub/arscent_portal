"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppShell, Empty, Loading } from "./AppShell";
import { HospitalOrderForm } from "./HospitalOrderForm";
import { HospitalReportPanel } from "./HospitalReportPanel";
import { OrderDetailModal, type OrderDetail } from "./OrderDetailModal";
import { fmtDate, monthBounds, thisMonthISO, todayISO } from "@/lib/dates";
import { ORDER_TYPE_LABELS, ORDER_STATUS_LABELS } from "@/lib/orders/orderTypeLabels";
import { workOrderNo } from "@/lib/orders/workOrderNo";
import type { OrderType } from "@/lib/supabase/database.types";
import { CartIcon, ClockIcon, DashboardIcon, PencilIcon, ReceiptIcon } from "./icons";
import { deleteOwnUsageEntry } from "@/app/manager/orders/actions";

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
// One specific physical unit still on consignment and not yet logged --
// one row per real batch/serial (not per order_line), since a single
// order_line commonly ships several distinct serials at once and each one
// needs its own exact batch number recorded when it's actually used, not
// one arbitrary batch shared across however many units are logged.
interface ConsignmentLine {
  key: string; // unique per batch -- `${orderLineId}|${batch}`
  id: string; // order_line id -- becomes source_order_line_id on the usage_log row / consumption order_line
  orderId: string;
  orderType: OrderType;
  poNumber: string | null;
  dcDate: string | null;
  skuId: string;
  skuName: string;
  itemMasterId: string | null;
  itemName: string | null;
  batch: string | null;
  netPrice: number | null;
}

// Consignment lines grouped by item for display -- a hospital doesn't care
// which shipment a unit arrived on, just "how much of this do I have" (and,
// expanded, exactly which batches those units are).
interface ConsignmentItemRow {
  key: string;
  itemName: string;
  available: number;
  batches: ConsignmentLine[];
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
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
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
  // remains; the hospital expands an item's sub-stock and marks off the
  // exact batch(es) actually used, rather than typing an aggregate qty.
  const [consignmentLines, setConsignmentLines] = useState<ConsignmentLine[] | null>(null);
  // Which specific batches (ConsignmentLine.key) are marked used -- this
  // set IS the qty: an item's "qty used" is just how many of its batches
  // are selected here, so there's no separate aggregate number that could
  // disagree with which real serials were actually picked.
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set());

  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);

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

  /** Only ever safe for an entry nothing downstream has touched yet -- the
   * server action (deleteOwnUsageEntry) is the actual authority on that,
   * since RLS blocks hospital logins from reading billing_requests to check
   * status client-side, so this button always shows and just surfaces
   * whatever the action reports back. */
  async function deleteHistoryRow(row: HistoryRow) {
    if (!confirm(`Delete this usage entry (${row.skus?.name ?? "item"}, qty ${row.qty})? This can't be undone.`)) return;
    setDeletingHistoryId(row.id);
    const res = await deleteOwnUsageEntry(row.id);
    setDeletingHistoryId(null);
    if (!res.success) {
      setMsg({ text: res.message, ok: false });
      return;
    }
    setMsg({ text: "Entry deleted.", ok: true });
    loadHistory();
    loadStats();
    loadConsignmentLines();
  }

  const loadOrders = useCallback(async () => {
    let q = supabase
      .from("orders")
      .select(
        "id, order_type, status, account_id, location_id, po_number, po_attachment_url, tracking_info, sales_invoice_url, requested_date, delivery_instruction, comment, created_at, order_lines(id, qty, net_price, notes, skus(name)), account_locations(name)"
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
      .select("id, order_id, sku_id, net_price, skus(name)")
      .in("order_id", orderIds);
    const lineById = new Map((origLines ?? []).map((l) => [l.id, l]));
    const lineIds = (origLines ?? []).map((l) => l.id);
    if (lineIds.length === 0) {
      setConsignmentLines([]);
      return;
    }

    const [{ data: usageRows }, { data: dcMovements }] = await Promise.all([
      supabase.from("usage_log").select("source_order_line_id, batch_number").in("source_order_line_id", lineIds),
      supabase
        .from("stock_movements")
        .select("order_line_id, item_id, batch_number, item_master(name)")
        .in("order_line_id", lineIds)
        .eq("category", "dc_out")
        .returns<{ order_line_id: string | null; item_id: string; batch_number: string | null; item_master: { name: string } | null }[]>(),
    ]);

    // A batch is unavailable once ANY usage_log row (pending or already
    // Recorded) has logged that exact batch against this line -- exact
    // match, not a qty tally, so a line's OTHER serials stay available even
    // after one specific one has been used.
    const consumedBatchKeys = new Set(
      (usageRows ?? [])
        .filter((r) => r.source_order_line_id && r.batch_number)
        .map((r) => `${r.source_order_line_id}|${r.batch_number}`)
    );

    const lines: ConsignmentLine[] = (dcMovements ?? [])
      .filter((m): m is typeof m & { order_line_id: string; batch_number: string } => !!m.order_line_id && !!m.batch_number)
      .filter((m) => !consumedBatchKeys.has(`${m.order_line_id}|${m.batch_number}`))
      .map((m) => {
        const origLine = lineById.get(m.order_line_id);
        const order = origLine ? orderById.get(origLine.order_id) : undefined;
        return {
          key: `${m.order_line_id}|${m.batch_number}`,
          id: m.order_line_id,
          orderId: origLine?.order_id ?? "",
          orderType: order?.order_type ?? "long_term_consignment",
          poNumber: order?.po_number ?? null,
          dcDate: order?.dc_date ?? null,
          skuId: origLine?.sku_id ?? "",
          skuName: origLine?.skus?.name ?? "—",
          itemMasterId: m.item_id,
          itemName: m.item_master?.name ?? null,
          batch: m.batch_number,
          netPrice: origLine?.net_price ?? null,
        };
      });
    setConsignmentLines(lines);
  }, [accountId, supabase]);

  const consignmentRows = useMemo<ConsignmentItemRow[] | null>(() => {
    if (!consignmentLines) return null;
    const map = new Map<string, ConsignmentItemRow>();
    for (const l of consignmentLines) {
      const key = l.itemMasterId ?? l.skuId;
      const name = l.itemName || l.skuName;
      const existing = map.get(key);
      if (existing) {
        existing.available += 1;
        existing.batches.push(l);
      } else {
        map.set(key, { key, itemName: name, available: 1, batches: [l] });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [consignmentLines]);

  function toggleBatchSelected(key: string) {
    setSelectedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    void (async () => {
      await Promise.all([loadStats(), loadHistory(), loadOrders(), loadConsignmentLines()]);
    })();
  }, [loadStats, loadHistory, loadOrders, loadConsignmentLines]);

  /** Builds the usage_log + consumption-order inserts for the selected batches. */
  async function commitUsageRows(rows: { line: ConsignmentLine; qtyNum: number }[], buildNote: (r: { line: ConsignmentLine; qtyNum: number }) => string) {
    setSaving(true);
    setMsg(null);

    // One consumption order per source order -- a single qty entered for
    // an item can draw from more than one DC shipment (oldest first), and
    // each shipment keeps its own PO number and order type. Created BEFORE
    // usage_log (below) so each usage_log row can record exactly which
    // consumption order_line it fed -- the one piece of information a
    // "delete this entry" action needs to find and remove the matching
    // order safely, instead of guessing from account/date/qty.
    const groups = new Map<string, { orderType: OrderType; poNumber: string | null; rows: typeof rows }>();
    for (const r of rows) {
      const g = groups.get(r.line.orderId) ?? { orderType: r.line.orderType, poNumber: r.line.poNumber, rows: [] };
      g.rows.push(r);
      groups.set(r.line.orderId, g);
    }

    const orderLineIdByRow = new Map<(typeof rows)[number], string>();

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
        setMsg({ text: "Couldn't create the billing record: " + (orderErr?.message ?? "unknown error"), ok: false });
        return false;
      }
      const { data: insertedLines, error: lineErr } = await supabase
        .from("order_lines")
        .insert(
          group.rows.map((r) => ({
            order_id: consumptionOrder.id,
            sku_id: r.line.skuId,
            qty: r.qtyNum,
            net_price: r.line.netPrice,
            notes: buildNote(r),
            source_order_line_id: r.line.id,
          }))
        )
        .select("id");
      if (lineErr || !insertedLines) {
        setSaving(false);
        setMsg({ text: "Couldn't create the billing record: " + (lineErr?.message ?? "unknown error"), ok: false });
        return false;
      }
      // Safe to zip positionally: a single multi-row INSERT ... RETURNING
      // preserves input order in both Postgres and PostgREST.
      group.rows.forEach((r, i) => {
        if (insertedLines[i]) orderLineIdByRow.set(r, insertedLines[i].id);
      });
    }

    const { error: usageErr } = await supabase.from("usage_log").insert(
      rows.map((r) => ({
        account_id: accountId,
        location_id: locationId ?? logLocationId,
        sku_id: r.line.skuId,
        item_master_id: r.line.itemMasterId || null,
        entry_date: date,
        qty: r.qtyNum,
        note: buildNote(r),
        batch_number: r.line.batch ?? "",
        // The usage_log billing trigger skips creating its own
        // billing_requests row when this is set -- billing for these
        // entries runs through the consumption order above instead
        // (Orders -> Send to Consignment), not automatically.
        source_order_line_id: r.line.id,
        consumption_order_line_id: orderLineIdByRow.get(r) ?? null,
        logged_by: userId,
      }))
    );
    if (usageErr) {
      setSaving(false);
      setMsg({ text: "Couldn't save — " + usageErr.message, ok: false });
      return false;
    }

    setSaving(false);
    setMsg({ text: `Logged ${rows.length} item(s).`, ok: true });
    loadStats();
    loadHistory();
    loadConsignmentLines();
    return true;
  }

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
    // table below); the hospital expands an item's sub-stock and marks off
    // the exact batch(es) actually used, so there's no FIFO guessing here --
    // each selected batch is one real, specific serial the hospital
    // confirmed themselves.
    const rows: { line: ConsignmentLine; qtyNum: number }[] = (consignmentLines ?? [])
      .filter((l) => selectedBatches.has(l.key))
      .map((line) => ({ line, qtyNum: 1 }));

    if (rows.length === 0) {
      setMsg({ text: "Select at least one batch to log usage for.", ok: false });
      return;
    }

    const noteFor = (r: (typeof rows)[number]) => {
      const label = r.line.itemName || r.line.skuName;
      return note.trim() ? `${label} — ${note.trim()}` : label;
    };

    const ok = await commitUsageRows(rows, noteFor);
    if (ok) {
      setNote("");
      setSelectedBatches(new Set());
    }
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
              <p className="mb-3.5 text-xs text-muted">Enter the quantity actually used for each consigned product below.</p>

              <div className="mb-3 flex flex-wrap gap-3">
                <div className="min-w-[150px] flex-1">
                  <label className="field-label">Date</label>
                  <input type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                {multiCenter && (
                  <div className="min-w-[150px] flex-1">
                    <label className="field-label">Center</label>
                    <select className="field-input" value={logLocationId} onChange={(e) => setLogLocationId(e.target.value)}>
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

              <form onSubmit={submitLog}>
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
                              <th></th>
                              <th>Product</th>
                              <th>Available</th>
                              <th>Qty used</th>
                            </tr>
                          </thead>
                          <tbody>
                            {consignmentRows.map((row) => {
                              const isOpen = expandedItemKey === row.key;
                              const usedCount = row.batches.filter((b) => selectedBatches.has(b.key)).length;
                              return (
                                <Fragment key={row.key}>
                                  <tr>
                                    <td>
                                      <button
                                        type="button"
                                        className="text-[11px] font-bold text-muted"
                                        onClick={() => setExpandedItemKey(isOpen ? null : row.key)}
                                      >
                                        {isOpen ? "−" : "+"}
                                      </button>
                                    </td>
                                    <td>{row.itemName}</td>
                                    <td>{row.available}</td>
                                    <td className={usedCount > 0 ? "font-bold text-brand" : "text-muted"}>
                                      {usedCount > 0 ? usedCount : "—"}
                                    </td>
                                  </tr>
                                  {isOpen && (
                                    <tr>
                                      <td colSpan={4} className="bg-app/60 !py-2">
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-muted">
                                          Sub-stock — click a batch to mark it used
                                        </div>
                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                          {row.batches.map((b) => {
                                            const used = selectedBatches.has(b.key);
                                            return (
                                              <button
                                                type="button"
                                                key={b.key}
                                                onClick={() => toggleBatchSelected(b.key)}
                                                title={b.poNumber ? `PO ${b.poNumber}` : undefined}
                                                className={
                                                  used
                                                    ? "rounded-[4px] border border-brand bg-brand px-2 py-1 font-mono text-[11px] font-bold text-white"
                                                    : "rounded-[4px] border border-border bg-card px-2 py-1 font-mono text-[11px] text-ink-soft"
                                                }
                                              >
                                                {b.batch ?? "no batch recorded"}
                                                {used ? " ✓" : ""}
                                              </button>
                                            );
                                          })}
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
                  <button type="submit" className="btn-primary" disabled={saving || (multiCenter && !logLocationId)}>
                    {saving ? "Saving…" : "Save entry"}
                  </button>
                  {msg && <span className={`ml-3 text-xs font-semibold ${msg.ok ? "text-good-fg" : "text-bad-fg"}`}>{msg.text}</span>}
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
                        <th></th>
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
                          <td>
                            <button
                              type="button"
                              className="rounded-[4px] border border-border bg-card px-2 py-1 text-[11px] font-bold text-ink-soft"
                              disabled={deletingHistoryId === e.id}
                              onClick={() => void deleteHistoryRow(e)}
                            >
                              {deletingHistoryId === e.id ? "Deleting…" : "Delete"}
                            </button>
                          </td>
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
                        <th>Sales Invoice</th>
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
                              <span className={`badge ${o.status === "closed" ? "badge-good" : o.status === "cancelled" ? "badge-bad" : "badge-neutral"}`}>
                                {ORDER_STATUS_LABELS[o.status] ?? o.status}
                              </span>
                              {o.status === "sent_to_hospital" && o.tracking_info && (
                                <div className="mt-0.5 text-[10px] text-muted">{o.tracking_info}</div>
                              )}
                            </td>
                            <td>
                              {o.sales_invoice_url ? (
                                <a
                                  href={o.sales_invoice_url}
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
