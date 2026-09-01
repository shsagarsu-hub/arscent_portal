"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "./AppShell";
import { ExportButton } from "./ExportButton";
import { workOrderNo } from "@/lib/orders/workOrderNo";
import { ORDER_TYPE_LABELS, ORDER_STATUS_LABELS } from "@/lib/orders/orderTypeLabels";
import type { OrderStatus, OrderType } from "@/lib/supabase/database.types";

interface StockOnHandRow {
  key: string;
  skuName: string;
  itemName: string;
  batch: string;
  expiryDate: string | null;
}

interface PurchasedConsumedRow {
  itemMasterId: string;
  itemName: string;
  purchased: number;
  consumed: number;
  balance: number;
}

interface UsageRow {
  entry_date: string;
  qty: number;
  skus: { name: string } | null;
}

interface OrderLineRow {
  qty: number;
  net_price: number | null;
  notes: string | null;
  skus: { name: string } | null;
}

interface OrderExportRow {
  id: string;
  order_type: OrderType;
  status: OrderStatus;
  po_number: string | null;
  created_at: string;
  order_lines: OrderLineRow[];
}

// Matches the same standing default used for the Zeiss PO email and the
// order-notification email -- orders here carry no per-order GST rate of
// their own (`tax_code` is free text, not a number), so this is the
// existing app-wide assumption, not a new one introduced for this export.
const EXPORT_GST_PERCENT = 5;

const TEAL = "#0e9488";
const TEAL_DARK = "#0a6d63";
const VIOLET = "#7c5cbf";
const VIOLET_DARK = "#5c3f99";
const AMBER = "#d68910";
const AMBER_DARK = "#a86a09";
const GOOD = "#1e8449";
const BAD = "#c0392b";
const NEUTRAL = "#2471a3";
const GRID = "#eef1f7";
const AXIS_TEXT = "#6b7c9e";
const CATEGORY_TEXT = "#2a3d64";

const STATUS_COLORS: Record<string, string> = {
  submitted: NEUTRAL,
  confirmed: TEAL,
  shipped: GOOD,
  cancelled: BAD,
};
const FALLBACK_COLORS = [TEAL, VIOLET, AMBER, NEUTRAL, GOOD, BAD];

const PERIODS = [
  { value: "3", label: "Last 3 months" },
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 8, border: "1px solid #dbe5f6", boxShadow: "0 8px 24px rgba(23,37,68,0.12)" };
const AXIS_TICK = { fontSize: 11, fill: AXIS_TEXT };

function inr(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function inrShort(n: number) {
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(0)}k`;
  return `₹${n}`;
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      className="rounded-[8px] border border-border bg-card p-3.5 text-center shadow-[0_1px_3px_rgba(23,37,68,0.06)]"
      style={{ borderTop: `2px solid ${accent}` }}
    >
      <div className="text-[19px] font-extrabold text-ink">{value}</div>
      <div className="mt-0.5 text-[9.5px] font-bold uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function ChartCard({
  eyebrow,
  title,
  subtitle,
  height,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  height?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="mb-3.5">
        <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: TEAL }}>
          {eyebrow}
        </span>
        <h3 className="mt-0.5 text-[14.5px] font-extrabold text-ink">{title}</h3>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>
      <div style={height ? { width: "100%", height } : undefined}>{children}</div>
    </div>
  );
}

/** This center's own usage and ordering trends -- scoped to account+location,
 * never cross-hospital. Deliberately doesn't reuse the account manager
 * Dashboard's revenue framing (that's Arscent's internal booked-revenue
 * view); a hospital cares about what it has consumed and ordered, not
 * company-wide financials. */
export function HospitalReportPanel({ accountId, locationId }: { accountId: string; locationId: string | null }) {
  const supabase = createClient();
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [orders, setOrders] = useState<OrderExportRow[] | null>(null);
  const [period, setPeriod] = useState("12");
  const [stockOnHand, setStockOnHand] = useState<StockOnHandRow[] | null>(null);
  const [purchasedConsumed, setPurchasedConsumed] = useState<PurchasedConsumedRow[] | null>(null);
  const [savingConsumedFor, setSavingConsumedFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    let usageQ = supabase.from("usage_log").select("entry_date, qty, skus(name)").eq("account_id", accountId);
    let ordersQ = supabase
      .from("orders")
      .select("id, order_type, status, po_number, created_at, order_lines(qty, net_price, notes, skus(name))")
      .eq("account_id", accountId);
    if (locationId) {
      usageQ = usageQ.eq("location_id", locationId);
      ordersQ = ordersQ.eq("location_id", locationId);
    }
    const [{ data: usageRows }, { data: orderRows }] = await Promise.all([
      usageQ.returns<UsageRow[]>(),
      ordersQ.returns<OrderExportRow[]>(),
    ]);
    setUsage(usageRows ?? []);
    setOrders(orderRows ?? []);
  }, [supabase, accountId, locationId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // Every physical unit currently at this hospital, down to its exact
  // serial and expiry -- same "still on consignment, not yet logged" set
  // Log Usage draws from, just flattened for reading rather than for
  // picking. Consignment stock is tracked per-account, not per-center, so
  // this pools every shipment across all of this account's centers.
  const loadStockOnHand = useCallback(async () => {
    const { data: matchedOrders } = await supabase
      .from("orders")
      .select("id, order_type")
      .eq("account_id", accountId)
      .in("order_type", ["long_term_consignment", "short_term_consignment"])
      .not("dc_number", "is", null)
      .returns<{ id: string; order_type: OrderType }[]>();

    if (!matchedOrders || matchedOrders.length === 0) {
      setStockOnHand([]);
      return;
    }
    const orderIds = matchedOrders.map((o) => o.id);

    const { data: origLines } = await supabase.from("order_lines").select("id, skus(name)").in("order_id", orderIds);
    const lineById = new Map((origLines ?? []).map((l) => [l.id, l]));
    const lineIds = (origLines ?? []).map((l) => l.id);
    if (lineIds.length === 0) {
      setStockOnHand([]);
      return;
    }

    const [{ data: usageRows }, { data: dcMovements }] = await Promise.all([
      supabase.from("usage_log").select("source_order_line_id, batch_number").in("source_order_line_id", lineIds),
      supabase
        .from("stock_movements")
        .select("order_line_id, batch_number, expiry_date, item_master(name)")
        .in("order_line_id", lineIds)
        .eq("category", "dc_out")
        .returns<{ order_line_id: string | null; batch_number: string | null; expiry_date: string | null; item_master: { name: string } | null }[]>(),
    ]);

    const consumedBatchKeys = new Set(
      (usageRows ?? [])
        .filter((r) => r.source_order_line_id && r.batch_number)
        .map((r) => `${r.source_order_line_id}|${r.batch_number}`)
    );

    const rows: StockOnHandRow[] = (dcMovements ?? [])
      .filter((m): m is typeof m & { order_line_id: string; batch_number: string } => !!m.order_line_id && !!m.batch_number)
      .filter((m) => !consumedBatchKeys.has(`${m.order_line_id}|${m.batch_number}`))
      .map((m) => ({
        key: `${m.order_line_id}|${m.batch_number}`,
        skuName: lineById.get(m.order_line_id)?.skus?.name ?? "—",
        itemName: m.item_master?.name ?? "—",
        batch: m.batch_number,
        expiryDate: m.expiry_date,
      }))
      .sort((a, b) => (a.expiryDate ?? "9999").localeCompare(b.expiryDate ?? "9999"));
    setStockOnHand(rows);
  }, [accountId, supabase]);

  // Purchased (every unit ever shipped to this account, regardless of
  // whether it's since been used) against Consumed -- a number the hospital
  // types in themselves for their own physical stock count, not the
  // official usage_log figure. This is deliberately a separate, manual
  // field: it's for the hospital's own reconciliation, and the account
  // manager's Consignment panel never reads it.
  const loadPurchasedConsumed = useCallback(async () => {
    const { data: matchedOrders } = await supabase
      .from("orders")
      .select("id")
      .eq("account_id", accountId)
      .in("order_type", ["long_term_consignment", "short_term_consignment"])
      .not("dc_number", "is", null);

    const orderIds = (matchedOrders ?? []).map((o) => o.id);
    let dcMovements: { item_id: string; item_master: { id: string; name: string } | null }[] = [];
    if (orderIds.length > 0) {
      const { data: lines } = await supabase.from("order_lines").select("id").in("order_id", orderIds);
      const lineIds = (lines ?? []).map((l) => l.id);
      if (lineIds.length > 0) {
        const { data } = await supabase
          .from("stock_movements")
          .select("item_id, item_master(id, name)")
          .in("order_line_id", lineIds)
          .eq("category", "dc_out")
          .returns<{ item_id: string; item_master: { id: string; name: string } | null }[]>();
        dcMovements = data ?? [];
      }
    }

    const purchasedByItem = new Map<string, { name: string; qty: number }>();
    for (const m of dcMovements) {
      const name = m.item_master?.name ?? "—";
      const cur = purchasedByItem.get(m.item_id) ?? { name, qty: 0 };
      cur.qty += 1;
      purchasedByItem.set(m.item_id, cur);
    }

    const { data: manual } = await supabase
      .from("hospital_manual_consumption")
      .select("item_master_id, consumed_qty")
      .eq("account_id", accountId);
    const consumedByItem = new Map((manual ?? []).map((m) => [m.item_master_id, m.consumed_qty]));

    const rows: PurchasedConsumedRow[] = Array.from(purchasedByItem.entries()).map(([itemMasterId, v]) => {
      const consumed = consumedByItem.get(itemMasterId) ?? 0;
      return { itemMasterId, itemName: v.name, purchased: v.qty, consumed, balance: v.qty - consumed };
    });
    rows.sort((a, b) => a.itemName.localeCompare(b.itemName));
    setPurchasedConsumed(rows);
  }, [accountId, supabase]);

  useEffect(() => {
    void loadStockOnHand();
    void loadPurchasedConsumed();
  }, [loadStockOnHand, loadPurchasedConsumed]);

  async function saveConsumed(itemMasterId: string, value: number) {
    setSavingConsumedFor(itemMasterId);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("hospital_manual_consumption").upsert(
      { account_id: accountId, item_master_id: itemMasterId, consumed_qty: value, updated_by: user?.id ?? null, updated_at: new Date().toISOString() },
      { onConflict: "account_id,item_master_id" }
    );
    setSavingConsumedFor(null);
    if (error) {
      alert("Couldn't save that — " + error.message);
      return;
    }
    setPurchasedConsumed((prev) =>
      (prev ?? []).map((r) => (r.itemMasterId === itemMasterId ? { ...r, consumed: value, balance: r.purchased - value } : r))
    );
  }

  const cutoff = useMemo(() => {
    if (period === "all") return null;
    const d = new Date();
    d.setMonth(d.getMonth() - Number(period));
    return d;
  }, [period]);

  const filteredUsage = useMemo(() => {
    if (!usage) return [];
    return usage.filter((u) => !cutoff || new Date(u.entry_date) >= cutoff);
  }, [usage, cutoff]);

  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => !cutoff || new Date(o.created_at) >= cutoff);
  }, [orders, cutoff]);

  const usageByMonth = useMemo(() => {
    const map = new Map<string, number>();
    filteredUsage.forEach((u) => {
      const key = monthKey(u.entry_date);
      map.set(key, (map.get(key) ?? 0) + u.qty);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, qty]) => ({ month: monthLabel(key), qty }));
  }, [filteredUsage]);

  const usageBySku = useMemo(() => {
    const map = new Map<string, number>();
    filteredUsage.forEach((u) => {
      const name = u.skus?.name ?? "—";
      map.set(name, (map.get(name) ?? 0) + u.qty);
    });
    return Array.from(map.entries())
      .map(([sku, qty]) => ({ sku, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10)
      .reverse();
  }, [filteredUsage]);

  const ordersByMonth = useMemo(() => {
    const map = new Map<string, number>();
    filteredOrders.forEach((o) => {
      const key = monthKey(o.created_at);
      const value = o.order_lines.reduce((a, l) => a + l.qty * (l.net_price ?? 0), 0);
      map.set(key, (map.get(key) ?? 0) + value);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ month: monthLabel(key), value }));
  }, [filteredOrders]);

  const ordersByStatus = useMemo(() => {
    const map = new Map<string, number>();
    filteredOrders.forEach((o) => {
      map.set(o.status, (map.get(o.status) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([status, count]) => ({ status, count }));
  }, [filteredOrders]);

  const stats = useMemo(() => {
    const unitsLogged = filteredUsage.reduce((a, u) => a + u.qty, 0);
    const orderValue = filteredOrders.reduce(
      (a, o) => a + o.order_lines.reduce((b, l) => b + l.qty * (l.net_price ?? 0), 0),
      0
    );
    return {
      entries: filteredUsage.length,
      unitsLogged,
      ordersPlaced: filteredOrders.length,
      orderValue,
    };
  }, [filteredUsage, filteredOrders]);

  // One row per order line -- PO number, price, and GST are only meaningful
  // at that granularity (a saleable order can carry several different
  // SKUs/prices under one work order number).
  const orderExportRows = useMemo(
    () =>
      filteredOrders.flatMap((o) =>
        o.order_lines.map((l) => {
          const lineTotal = l.qty * (l.net_price ?? 0);
          const gstAmount = lineTotal * (EXPORT_GST_PERCENT / 100);
          return {
            workOrderNo: workOrderNo(o.id, o.created_at),
            date: new Date(o.created_at).toLocaleDateString("en-IN"),
            type: ORDER_TYPE_LABELS[o.order_type] ?? o.order_type,
            status: ORDER_STATUS_LABELS[o.status] ?? o.status,
            poNumber: o.po_number ?? "",
            sku: l.skus?.name ?? "—",
            spec: l.notes ?? "",
            qty: l.qty,
            netPrice: l.net_price ?? "",
            lineTotalExGst: lineTotal,
            gstPercent: EXPORT_GST_PERCENT,
            lineTotalInclGst: lineTotal + gstAmount,
          };
        })
      ),
    [filteredOrders]
  );

  if (usage === null || orders === null) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: NEUTRAL }}>
              Detailed MIS
            </span>
            <h3 className="mt-0.5 text-[14.5px] font-extrabold text-ink">Stock on hand — by serial</h3>
            <p className="text-xs text-muted">
              Every unit currently at your account, with its exact serial and expiry — helps you track physical stock.
            </p>
          </div>
          <ExportButton
            filename="stock-on-hand-mis"
            columns={[
              { key: "itemName", label: "SKU" },
              { key: "batch", label: "Serial Number" },
              { key: "expiryDate", label: "Expiry Date" },
              { key: "qty", label: "Qty" },
            ]}
            rows={(stockOnHand ?? []).map((r) => ({ itemName: r.itemName, batch: r.batch, expiryDate: r.expiryDate ?? "", qty: 1 }))}
          />
        </div>
        {stockOnHand === null ? (
          <Loading />
        ) : stockOnHand.length === 0 ? (
          <Empty title="Nothing on hand" body="Stock sent to you on consignment will show up here, serial by serial." />
        ) : (
          <div className="max-h-80 overflow-y-auto overflow-x-auto">
            <table className="u-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Serial Number</th>
                  <th>Expiry Date</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {stockOnHand.map((r) => (
                  <tr key={r.key}>
                    <td className="whitespace-nowrap">{r.itemName}</td>
                    <td className="whitespace-nowrap font-mono text-[12px]">{r.batch}</td>
                    <td className="whitespace-nowrap">{r.expiryDate ? new Date(r.expiryDate).toLocaleDateString("en-IN") : "—"}</td>
                    <td>1</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: AMBER }}>
              Your own tracking
            </span>
            <h3 className="mt-0.5 text-[14.5px] font-extrabold text-ink">Purchased − Consumed = Balance</h3>
            <p className="text-xs text-muted">
              Enter what you&apos;ve physically used yourself — this is for your own records only and isn&apos;t shared with Arscent.
            </p>
          </div>
          <ExportButton
            filename="purchased-consumed"
            columns={[
              { key: "itemName", label: "SKU" },
              { key: "purchased", label: "Purchased" },
              { key: "consumed", label: "Consumed" },
              { key: "balance", label: "Balance" },
            ]}
            rows={purchasedConsumed ?? []}
          />
        </div>
        {purchasedConsumed === null ? (
          <Loading />
        ) : purchasedConsumed.length === 0 ? (
          <Empty title="Nothing received yet" body="Once stock is sent to you, it'll show up here to track against your own usage." />
        ) : (
          <div className="max-h-80 overflow-y-auto overflow-x-auto">
            <table className="u-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Purchased</th>
                  <th>Consumed</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {purchasedConsumed.map((r) => (
                  <tr key={r.itemMasterId}>
                    <td className="whitespace-nowrap">{r.itemName}</td>
                    <td>{r.purchased}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        defaultValue={r.consumed}
                        className="w-20 rounded-[4px] border border-border px-2 py-1 text-[12.5px] outline-none focus:border-accent"
                        disabled={savingConsumedFor === r.itemMasterId}
                        onBlur={(e) => {
                          const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                          if (v !== r.consumed) saveConsumed(r.itemMasterId, v);
                        }}
                      />
                    </td>
                    <td className={r.balance < 0 ? "font-bold text-bad-fg" : "font-bold"}>{r.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-[10px] border border-border shadow-[0_1px_3px_rgba(23,37,68,0.06)]">
        <div
          className="flex flex-wrap items-end justify-between gap-3 px-4 py-4 sm:px-5"
          style={{ background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_DARK} 100%)` }}
        >
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-white/70">
              {locationId ? "This center" : "Your account"}
            </span>
            <h3 className="mt-0.5 text-[17px] font-extrabold text-white">Usage &amp; Orders Report</h3>
            <p className="mt-0.5 text-xs text-white/80">
              {locationId
                ? "Your own logged usage and orders placed — nothing from other centers."
                : "Usage and orders across every center on your account — nothing from other hospitals."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-[6px] border-0 bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold text-white outline-none [color-scheme:dark]"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value} className="text-ink">
                  {p.label}
                </option>
              ))}
            </select>
            <ExportButton
              dark
              filename="orders-mis"
              columns={[
                { key: "workOrderNo", label: "Work Order #" },
                { key: "date", label: "Date" },
                { key: "type", label: "Type" },
                { key: "status", label: "Status" },
                { key: "poNumber", label: "PO Number" },
                { key: "sku", label: "SKU" },
                { key: "spec", label: "Spec" },
                { key: "qty", label: "Qty" },
                { key: "netPrice", label: "Net Price" },
                { key: "lineTotalExGst", label: "Line Total (ex GST)" },
                { key: "gstPercent", label: "GST %" },
                { key: "lineTotalInclGst", label: "Line Total (incl GST)" },
              ]}
              rows={orderExportRows}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 bg-card p-3.5 sm:grid-cols-4">
          <StatCard label="Units Logged" value={stats.unitsLogged.toLocaleString("en-IN")} accent={TEAL} />
          <StatCard label="Entries Logged" value={String(stats.entries)} accent={VIOLET} />
          <StatCard label="Orders Placed" value={String(stats.ordersPlaced)} accent={AMBER} />
          <StatCard label="Order Value" value={inr(stats.orderValue)} accent={GOOD} />
        </div>
      </div>

      <ChartCard eyebrow="Trend" title="Usage logged over time" subtitle="Total units logged, by month." height={260}>
        {usageByMonth.length === 0 ? (
          <Empty title="No usage in this window" body="Widen the period, or log usage to see it here." />
        ) : (
          <ResponsiveContainer>
            <BarChart data={usageByMonth} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="hospUsageGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TEAL} />
                  <stop offset="100%" stopColor={TEAL_DARK} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={AXIS_TICK} axisLine={{ stroke: "#dbe5f6" }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
              <Tooltip formatter={(v) => [Number(v).toLocaleString("en-IN"), "Units"]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: GRID }} />
              <Bar dataKey="qty" name="Units" fill="url(#hospUsageGradient)" radius={[6, 6, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard eyebrow="Products" title="Usage by SKU" subtitle="Top 10 products by units logged." height={Math.max(240, usageBySku.length * 32)}>
          {usageBySku.length === 0 ? (
            <Empty title="No usage in this window" body="Widen the period, or log usage to see it here." />
          ) : (
            <ResponsiveContainer>
              <BarChart data={usageBySku} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="hospSkuGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#9678d6" />
                    <stop offset="100%" stopColor={VIOLET_DARK} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="sku" width={150} tick={{ fontSize: 11, fill: CATEGORY_TEXT }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => [Number(v).toLocaleString("en-IN"), "Units"]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: GRID }} />
                <Bar dataKey="qty" name="Units" fill="url(#hospSkuGradient)" radius={[0, 6, 6, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard eyebrow="Pipeline" title="Orders by status" subtitle="Where your placed orders currently stand." height={260}>
          {ordersByStatus.length === 0 ? (
            <Empty title="No orders in this window" body="Widen the period, or place an order to see it here." />
          ) : (
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={ordersByStatus}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={3}
                  stroke="#fff"
                  strokeWidth={2}
                >
                  {ordersByStatus.map((entry, i) => (
                    <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => v.charAt(0).toUpperCase() + v.slice(1)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <ChartCard eyebrow="Trend" title="Orders placed over time" subtitle="Total order value (qty × net price), by month." height={260}>
        {ordersByMonth.length === 0 ? (
          <Empty title="No orders in this window" body="Widen the period, or place an order to see it here." />
        ) : (
          <ResponsiveContainer>
            <BarChart data={ordersByMonth} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="hospOrderGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e2ad4a" />
                  <stop offset="100%" stopColor={AMBER_DARK} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={AXIS_TICK} axisLine={{ stroke: "#dbe5f6" }} tickLine={false} />
              <YAxis tickFormatter={inrShort} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
              <Tooltip formatter={(v) => inr(Number(v))} contentStyle={TOOLTIP_STYLE} cursor={{ fill: GRID }} />
              <Bar dataKey="value" name="Order value" fill="url(#hospOrderGradient)" radius={[6, 6, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
