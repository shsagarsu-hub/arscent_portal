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
import { MonthMultiSelect } from "./MonthMultiSelect";
import { BoxIcon, ChartIcon, ClipboardIcon, ReceiptIcon } from "./icons";
import { MisExportButton } from "./MisExportButton";
import type { MisSheet } from "@/lib/exportMis";

interface TallyLineRow {
  invoice_no: string;
  invoice_date: string;
  qty: number;
  rate: number | null;
  account_id: string;
  document_type: "invoice" | "credit_note" | "debit_note";
  accounts: { label: string } | null;
  skus: { name: string } | null;
  item_master: { name: string } | null;
}

interface BilledConsignmentRow {
  invoice_number: string | null;
  invoice_date: string | null;
  entry_date: string;
  qty: number;
  amount: number | null;
  account_id: string;
  accounts: { label: string } | null;
  skus: { name: string } | null;
}

interface ClosedSaleableRow {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  account_id: string;
  accounts: { label: string } | null;
  order_lines: { qty: number; net_price: number | null; skus: { name: string } | null }[];
}

interface OrderRow {
  id: string;
  order_type: string;
  status: string;
  created_at: string;
  account_id: string;
  accounts: { label: string } | null;
  order_lines: { qty: number; net_price: number | null; skus: { name: string } | null }[];
}

interface RevenueEvent {
  date: string;
  accountId: string;
  account: string;
  sku: string;
  qty: number;
  revenue: number;
  invoiceKey: string;
  source: "Tally Invoice" | "Consignment" | "Saleable Order";
  isInvoiceDocument: boolean;
}

interface AccountOption {
  id: string;
  label: string;
}

const BRAND = "#2f5fc7";
const BRAND_DARK = "#1f3f8f";
const ACCENT = "#4a7fe0";
const GOOD = "#1e8449";
const WATCH = "#d68910";
const NEUTRAL = "#2471a3";
const GRID = "#eef1f7";
const AXIS_TEXT = "#6b7c9e";
const CATEGORY_TEXT = "#2a3d64";

const SALEABLE = "#8e44ad";

const SOURCE_COLORS: Record<string, string> = {
  "Tally Invoice": BRAND,
  Consignment: GOOD,
  "Saleable Order": SALEABLE,
};

/** Last `n` months including the current one, ascending, as YYYY-MM strings
 * -- the default selection, standing in for the old "Last 12 months" preset. */
function lastNMonths(n: number) {
  const now = new Date();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #dbe5f6",
  boxShadow: "0 8px 24px rgba(23,37,68,0.12)",
};
const AXIS_TICK = { fontSize: 11, fill: AXIS_TEXT };

function inr(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function inrShort(n: number) {
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(0)}k`;
  return `₹${n}`;
}

function monthKey(iso: string) {
  return iso.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-[8px] border border-border bg-card p-3.5 shadow-[0_1px_3px_rgba(23,37,68,0.06)]"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"
        style={{ backgroundColor: `${accent}1a`, color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="break-words text-[15px] font-extrabold leading-tight text-ink sm:text-[19px]">{value}</div>
        <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted">{label}</div>
      </div>
    </div>
  );
}

function ChartCard({
  eyebrow,
  title,
  height,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  height?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card shadow-[0_1px_3px_rgba(23,37,68,0.06)]">
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand">{eyebrow}</span>
          <h3 className="mt-0.5 text-[14.5px] font-extrabold text-ink">{title}</h3>
        </div>
        {action}
      </div>
      <div style={height ? { width: "100%", height } : undefined}>{children}</div>
    </div>
  );
}

/** Revenue-booked and orders-placed reporting for account managers, built
 * from the same three real, reviewer-confirmed sources that already back Vs
 * Committed's Actual column -- tally_invoice_lines (confirmed Tally sales
 * invoices), billing_requests where status='billed' (invoiced consignment
 * usage, whether it started from a hospital's Log Usage or an LTC/STC order
 * sent to Consignment), and orders where order_type='saleable' and
 * status='closed' (directly invoiced on the order, no Consignment detour)
 * -- never a plain submitted/confirmed order, which is just a request until
 * one of those three things happens to it. */
export function DashboardPanel() {
  const supabase = createClient();
  const [tallyRows, setTallyRows] = useState<TallyLineRow[] | null>(null);
  const [billedRows, setBilledRows] = useState<BilledConsignmentRow[] | null>(null);
  const [saleableRows, setSaleableRows] = useState<ClosedSaleableRow[] | null>(null);
  const [allOrders, setAllOrders] = useState<OrderRow[] | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [months, setMonths] = useState<string[]>(() => lastNMonths(12));
  const [accountFilter, setAccountFilter] = useState("");

  const load = useCallback(async () => {
    const [{ data: tally }, { data: billed }, { data: saleable }, { data: orders }, { data: accountRows }] = await Promise.all([
      supabase
        .from("tally_invoice_lines")
        .select(
          "invoice_no, invoice_date, qty, rate, account_id, document_type, accounts(label), skus(name), item_master(name)"
        )
        .returns<TallyLineRow[]>(),
      supabase
        .from("billing_requests")
        .select("invoice_number, invoice_date, entry_date, qty, amount, account_id, accounts(label), skus(name)")
        .eq("status", "billed")
        .returns<BilledConsignmentRow[]>(),
      supabase
        .from("orders")
        .select("id, invoice_number, invoice_date, account_id, accounts(label), order_lines(qty, net_price, skus(name))")
        .eq("order_type", "saleable")
        .eq("status", "closed")
        .returns<ClosedSaleableRow[]>(),
      // Every order regardless of type/status -- unlike the revenue events
      // above (which only count what's actually billed), this report is
      // meant to answer "what has been ordered" literally from the orders
      // table itself, the same data Orders/Consignment already work from.
      supabase
        .from("orders")
        .select("id, order_type, status, created_at, account_id, accounts(label), order_lines(qty, net_price, skus(name))")
        .returns<OrderRow[]>(),
      supabase.from("accounts").select("id, label").order("label"),
    ]);
    setTallyRows(tally ?? []);
    setBilledRows(billed ?? []);
    setSaleableRows(saleable ?? []);
    setAllOrders(orders ?? []);
    setAccounts(accountRows ?? []);
  }, [supabase]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const events = useMemo<RevenueEvent[]>(() => {
    const fromTally = (tallyRows ?? []).map((r) => ({
      date: r.invoice_date,
      accountId: r.account_id,
      account: r.accounts?.label ?? "—",
      sku: r.skus?.name ?? r.item_master?.name ?? "—",
      // Credit/debit note lines carry a placeholder qty of 1 (a ledger-line
      // marker, not a real physical unit -- see parsePdf.ts), so Units
      // Booked and Top SKUs must not count it. Revenue still uses the raw
      // qty * signed rate below, so the adjustment nets in correctly.
      qty: r.document_type === "invoice" ? r.qty : 0,
      revenue: r.qty * (r.rate ?? 0),
      invoiceKey: `tally:${r.invoice_no}`,
      source: "Tally Invoice" as const,
      isInvoiceDocument: r.document_type === "invoice",
    }));
    const fromConsignment = (billedRows ?? []).map((r) => ({
      date: r.invoice_date ?? r.entry_date,
      accountId: r.account_id,
      account: r.accounts?.label ?? "—",
      sku: r.skus?.name ?? "—",
      qty: r.qty,
      revenue: r.amount ?? 0,
      invoiceKey: `consignment:${r.invoice_number ?? r.entry_date}`,
      source: "Consignment" as const,
      isInvoiceDocument: true,
    }));
    // A closed saleable order whose invoice_number matches one already
    // present in tally_invoice_lines is the SAME real-world sale recorded
    // twice -- e.g. an order backfilled to match a historical Tally import
    // (see NN1/NN2 backfill). Tally is the authoritative accounting record,
    // so that order is excluded here rather than double-counted; a genuine
    // saleable order that was never re-entered into Tally has no matching
    // invoice_no and still counts normally.
    const tallyInvoiceNos = new Set((tallyRows ?? []).map((r) => r.invoice_no));
    const fromSaleable = (saleableRows ?? [])
      .filter((o) => o.invoice_date && !(o.invoice_number && tallyInvoiceNos.has(o.invoice_number)))
      .flatMap((o) =>
        o.order_lines.map((l) => ({
          date: o.invoice_date as string,
          accountId: o.account_id,
          account: o.accounts?.label ?? "—",
          sku: l.skus?.name ?? "—",
          qty: l.qty,
          revenue: l.qty * (l.net_price ?? 0),
          invoiceKey: `order:${o.invoice_number ?? o.id}`,
          source: "Saleable Order" as const,
          isInvoiceDocument: true,
        }))
      );
    return [...fromTally, ...fromConsignment, ...fromSaleable];
  }, [tallyRows, billedRows, saleableRows]);

  const filtered = useMemo(() => {
    const monthSet = months.length > 0 ? new Set(months) : null; // empty selection = all time
    return events.filter((e) => {
      if (accountFilter && e.accountId !== accountFilter) return false;
      if (monthSet && !monthSet.has(monthKey(e.date))) return false;
      return true;
    });
  }, [events, months, accountFilter]);

  const revenueByMonth = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((e) => {
      const key = monthKey(e.date);
      map.set(key, (map.get(key) ?? 0) + e.revenue);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, revenue]) => ({ month: monthLabel(key), revenue }));
  }, [filtered]);

  const revenueByAccount = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((e) => {
      map.set(e.account, (map.get(e.account) ?? 0) + e.revenue);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([account, revenue]) => ({ account, revenue }));
  }, [filtered]);

  const topSkus = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((e) => {
      map.set(e.sku, (map.get(e.sku) ?? 0) + e.qty);
    });
    return Array.from(map.entries())
      .map(([sku, qty]) => ({ sku, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10)
      .reverse(); // vertical bar chart reads bottom-to-top, so reverse for biggest-on-top
  }, [filtered]);

  // Distinct from Top SKUs above -- that's revenue booked (Tally + billed
  // consignment + closed saleable), this is literally every row in the
  // orders table regardless of type or status, so an AM can see what's
  // actually been placed/requested, not just what's gone on to be billed.
  const ordersBySku = useMemo(() => {
    const map = new Map<string, { orders: Set<string>; qty: number; value: number }>();
    (allOrders ?? [])
      .filter((o) => (!accountFilter || o.account_id === accountFilter) && (months.length === 0 || months.includes(monthKey(o.created_at))))
      .forEach((o) => {
        o.order_lines.forEach((l) => {
          const sku = l.skus?.name ?? "—";
          const entry = map.get(sku) ?? { orders: new Set<string>(), qty: 0, value: 0 };
          entry.orders.add(o.id);
          entry.qty += l.qty;
          entry.value += l.qty * (l.net_price ?? 0);
          map.set(sku, entry);
        });
      });
    return Array.from(map.entries())
      .map(([sku, v]) => ({ sku, orders: v.orders.size, qty: v.qty, value: v.value }))
      .sort((a, b) => b.qty - a.qty);
  }, [allOrders, accountFilter, months]);

  const revenueBySource = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((e) => {
      map.set(e.source, (map.get(e.source) ?? 0) + e.revenue);
    });
    return Array.from(map.entries()).map(([source, revenue]) => ({ source, revenue }));
  }, [filtered]);

  const stats = useMemo(() => {
    const invoiceKeys = new Set(filtered.filter((e) => e.isInvoiceDocument).map((e) => e.invoiceKey));
    const totalRevenue = filtered.reduce((a, e) => a + e.revenue, 0);
    const totalQty = filtered.reduce((a, e) => a + e.qty, 0);
    return {
      invoices: invoiceKeys.size,
      revenue: totalRevenue,
      qty: totalQty,
      avgInvoiceValue: invoiceKeys.size > 0 ? totalRevenue / invoiceKeys.size : 0,
    };
  }, [filtered]);

  // The full MIS behind this dashboard -- one sheet per breakdown shown
  // above, unabridged (the charts truncate to top 10; this doesn't), plus a
  // raw detail sheet. This is what "Export MIS to Excel" hands back -- the
  // underlying data, not a picture of the charts.
  const misSheets = useMemo<MisSheet[]>(() => {
    const skuMap = new Map<string, number>();
    filtered.forEach((e) => skuMap.set(e.sku, (skuMap.get(e.sku) ?? 0) + e.qty));
    const allSkuRows = Array.from(skuMap.entries())
      .map(([sku, qty]) => ({ sku, qty }))
      .sort((a, b) => b.qty - a.qty);

    return [
      {
        name: "Summary",
        columns: [
          { key: "label", label: "Metric", width: 24 },
          { key: "value", label: "Value", width: 20 },
        ],
        rows: [
          { label: "Revenue Booked", value: stats.revenue },
          { label: "Invoices Booked", value: stats.invoices },
          { label: "Units Booked", value: stats.qty },
          { label: "Avg Invoice Value", value: stats.avgInvoiceValue },
        ],
      },
      {
        name: "Revenue by Month",
        columns: [
          { key: "month", label: "Month", width: 16 },
          { key: "revenue", label: "Revenue", width: 18 },
        ],
        rows: revenueByMonth,
      },
      {
        name: "Revenue by Account",
        columns: [
          { key: "account", label: "Account", width: 32 },
          { key: "revenue", label: "Revenue", width: 18 },
        ],
        rows: revenueByAccount,
      },
      {
        name: "Revenue by Source",
        columns: [
          { key: "source", label: "Source", width: 20 },
          { key: "revenue", label: "Revenue", width: 18 },
        ],
        rows: revenueBySource,
      },
      {
        name: "Units Booked by SKU",
        columns: [
          { key: "sku", label: "SKU", width: 36 },
          { key: "qty", label: "Units booked", width: 16 },
        ],
        rows: allSkuRows,
      },
      {
        name: "Orders by SKU",
        columns: [
          { key: "sku", label: "SKU", width: 36 },
          { key: "orders", label: "Orders", width: 12 },
          { key: "qty", label: "Qty", width: 12 },
          { key: "value", label: "Value", width: 18 },
        ],
        rows: ordersBySku,
      },
      {
        name: "Raw Revenue Events",
        columns: [
          { key: "date", label: "Date", width: 14 },
          { key: "account", label: "Account", width: 32 },
          { key: "sku", label: "SKU", width: 36 },
          { key: "qty", label: "Qty", width: 10 },
          { key: "revenue", label: "Revenue", width: 16 },
          { key: "source", label: "Source", width: 16 },
        ],
        rows: filtered,
      },
    ];
  }, [filtered, revenueByMonth, revenueByAccount, revenueBySource, ordersBySku, stats]);

  if (tallyRows === null || billedRows === null || saleableRows === null || allOrders === null) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[10px] border border-border shadow-[0_1px_3px_rgba(23,37,68,0.06)]">
        <div
          className="flex flex-wrap items-end justify-between gap-3 px-4 py-4 sm:px-5"
          style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }}
        >
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-white/70">
              Account Manager
            </span>
            <h3 className="mt-0.5 text-[17px] font-extrabold text-white">Dashboard &amp; Reports</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <MonthMultiSelect months={months} onChange={setMonths} dark allowAllTime />
            <select
              className="rounded-[6px] border-0 bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold text-white outline-none [color-scheme:dark]"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
            >
              <option value="" className="text-ink">
                All accounts
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="text-ink">
                  {a.label}
                </option>
              ))}
            </select>
            <MisExportButton dark filename="dashboard-mis" sheets={misSheets} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 bg-card p-3.5 sm:grid-cols-4">
          <StatCard label="Revenue Booked" value={inr(stats.revenue)} icon={<ReceiptIcon />} accent={BRAND} />
          <StatCard label="Invoices Booked" value={String(stats.invoices)} icon={<ClipboardIcon />} accent={ACCENT} />
          <StatCard label="Units Booked" value={stats.qty.toLocaleString("en-IN")} icon={<BoxIcon />} accent={GOOD} />
          <StatCard label="Avg Invoice Value" value={inr(stats.avgInvoiceValue)} icon={<ChartIcon />} accent={WATCH} />
        </div>
      </div>

      <ChartCard
        eyebrow="Trend"
        title="Revenue booked over time"
        height={280}
      >
        {revenueByMonth.length === 0 ? (
          <Empty title="No revenue in this window" body="Widen the period or account filter." />
        ) : (
          <ResponsiveContainer>
            <BarChart data={revenueByMonth} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} />
                  <stop offset="100%" stopColor={BRAND_DARK} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={AXIS_TICK} axisLine={{ stroke: "#dbe5f6" }} tickLine={false} />
              <YAxis tickFormatter={inrShort} tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
              <Tooltip formatter={(v) => inr(Number(v))} contentStyle={TOOLTIP_STYLE} cursor={{ fill: GRID }} />
              <Bar dataKey="revenue" name="Revenue" fill="url(#revenueGradient)" radius={[6, 6, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          eyebrow="Breakdown"
          title="Revenue by account"
          height={260}
        >
          {revenueByAccount.length === 0 ? (
            <Empty title="No revenue in this window" body="Widen the period or account filter." />
          ) : (
            <ResponsiveContainer>
              <BarChart data={revenueByAccount} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="accountGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={ACCENT} />
                    <stop offset="100%" stopColor={BRAND} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tickFormatter={inrShort} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="account"
                  width={150}
                  tick={{ fontSize: 11, fill: CATEGORY_TEXT }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip formatter={(v) => inr(Number(v))} contentStyle={TOOLTIP_STYLE} cursor={{ fill: GRID }} />
                <Bar dataKey="revenue" name="Revenue" fill="url(#accountGradient)" radius={[0, 6, 6, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          eyebrow="Mix"
          title="Revenue by source"
          height={260}
        >
          {revenueBySource.length === 0 ? (
            <Empty title="No revenue in this window" body="Widen the period or account filter." />
          ) : (
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={revenueBySource}
                  dataKey="revenue"
                  nameKey="source"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={3}
                  stroke="#fff"
                  strokeWidth={2}
                >
                  {revenueBySource.map((entry) => (
                    <Cell key={entry.source} fill={SOURCE_COLORS[entry.source] ?? NEUTRAL} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => inr(Number(v))} contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <ChartCard
        eyebrow="Products"
        title="Units booked by SKU"
        height={Math.max(260, topSkus.length * 34)}
      >
        {topSkus.length === 0 ? (
          <Empty title="No revenue in this window" body="Widen the period or account filter." />
        ) : (
          <ResponsiveContainer>
            <BarChart data={topSkus} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="skuGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#37a06b" />
                  <stop offset="100%" stopColor={GOOD} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="sku"
                width={170}
                tick={{ fontSize: 11, fill: CATEGORY_TEXT }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v) => [Number(v).toLocaleString("en-IN"), "Units booked"]}
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: GRID }}
              />
              <Bar dataKey="qty" name="Units booked" fill="url(#skuGradient)" radius={[0, 6, 6, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="card shadow-[0_1px_3px_rgba(23,37,68,0.06)]">
        <div className="mb-3.5 flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand">Products</span>
            <h3 className="mt-0.5 text-[14.5px] font-extrabold text-ink">Orders by SKU</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              Every row in the orders table, any type or status — not just what&apos;s gone on to be billed.
            </p>
          </div>
        </div>
        {ordersBySku.length === 0 ? (
          <Empty title="No orders in this window" body="Widen the period or account filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wide text-muted-strong">
                  <th className="py-1.5 pr-3">SKU</th>
                  <th className="py-1.5 pr-3 text-right">Orders</th>
                  <th className="py-1.5 pr-3 text-right">Qty</th>
                  <th className="py-1.5 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {ordersBySku.map((row) => (
                  <tr key={row.sku} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 font-semibold text-ink">{row.sku}</td>
                    <td className="py-1.5 pr-3 text-right">{row.orders}</td>
                    <td className="py-1.5 pr-3 text-right">{row.qty.toLocaleString("en-IN")}</td>
                    <td className="py-1.5 text-right">{inr(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
