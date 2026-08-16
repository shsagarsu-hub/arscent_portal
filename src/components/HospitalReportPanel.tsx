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

interface UsageRow {
  entry_date: string;
  qty: number;
  skus: { name: string } | null;
}

interface OrderLineRow {
  qty: number;
  net_price: number | null;
}

interface OrderRow {
  id: string;
  status: string;
  created_at: string;
  order_lines: OrderLineRow[];
}

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
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [period, setPeriod] = useState("12");

  const load = useCallback(async () => {
    let usageQ = supabase.from("usage_log").select("entry_date, qty, skus(name)").eq("account_id", accountId);
    let ordersQ = supabase.from("orders").select("id, status, created_at, order_lines(qty, net_price)").eq("account_id", accountId);
    if (locationId) {
      usageQ = usageQ.eq("location_id", locationId);
      ordersQ = ordersQ.eq("location_id", locationId);
    }
    const [{ data: usageRows }, { data: orderRows }] = await Promise.all([
      usageQ.returns<UsageRow[]>(),
      ordersQ.returns<OrderRow[]>(),
    ]);
    setUsage(usageRows ?? []);
    setOrders(orderRows ?? []);
  }, [supabase, accountId, locationId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

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

  if (usage === null || orders === null) return <Loading />;

  return (
    <div className="space-y-4">
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
