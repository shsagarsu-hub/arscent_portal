import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthBounds, thisMonthISO } from "@/lib/dates";

interface SkuRow {
  id: string;
  name: string;
  account_id: string;
  commitment_per_month: number | null;
  units_per_pack: number | null;
  accounts: { label: string; commitment_start: string | null } | null;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * A Google Sheet's IMPORTDATA can't send an auth header or cookie -- it's a
 * plain unauthenticated GET -- so this route is gated by a shared-secret
 * query token instead of the usual signed-in-profile check every other
 * privileged read in this app uses before reaching for createAdminClient().
 *
 * This is a deliberate line-for-line port of ManagerPortal.tsx's own
 * "Actual vs committed" computation (the same one CommittedPanel renders on
 * screen) -- same three revenue sources, same revenue-gating, same
 * units_per_pack conversion, same cumulative-target-across-selected-months
 * math, same Target-minus-Actual sign. Earlier versions of this feed
 * re-derived the numbers independently (their own consignment-order
 * counting, their own per-month layout) and drifted from what the app
 * itself shows -- LVPEI reading 500 here when the live panel would have
 * read 0, Rajajinagar SMILE showing raw monthly qty instead of the
 * cumulative-across-selected-months figure the panel displays. Any future
 * change to ManagerPortal's actualBySku logic should be mirrored here too.
 *
 * ?months=2026-08,2026-09 (comma-separated, defaults to the current month)
 * -- exactly what MonthMultiSelect drives on screen. Can be non-contiguous.
 *
 * ?account=<substring> scopes the whole feed to one account (case-insensitive
 * match against the account's label) -- so three separate IMPORTDATA calls,
 * each with a different account filter, can each land in their own box on
 * the same sheet instead of one long mixed table.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!process.env.REPORTS_API_TOKEN || token !== process.env.REPORTS_API_TOKEN) {
    return new Response("Not authorized.", { status: 401 });
  }

  const monthsParam = url.searchParams.get("months");
  const months = monthsParam ? monthsParam.split(",").map((m) => m.trim()) : [thisMonthISO()];
  const accountFilter = url.searchParams.get("account")?.trim().toLowerCase() || null;

  const supabase = createAdminClient();

  // Same "widen to the full span, then filter to the exact selected months
  // client-side" approach as ManagerPortal.load() -- gte/lt alone can't
  // express a non-contiguous set like "Jun + Aug, skipping Jul" in one query.
  const sortedMonths = months.slice().sort();
  const { start } = monthBounds(sortedMonths[0]);
  const { end } = monthBounds(sortedMonths[sortedMonths.length - 1]);
  const monthSet = new Set(months);
  const inSelectedMonths = (dateISO: string | null) => !!dateISO && monthSet.has(dateISO.slice(0, 7));

  const [{ data: allSkuRows }, { data: tallyRowsRaw }, { data: billedRowsRaw }, { data: closedSaleableRowsRaw }] = await Promise.all([
    supabase
      .from("skus")
      .select("id, name, account_id, commitment_per_month, units_per_pack, accounts(label, commitment_start)")
      .returns<SkuRow[]>(),
    supabase
      .from("tally_invoice_lines")
      .select("sku_id, account_id, qty, rate, invoice_date, invoice_no")
      .eq("document_type", "invoice")
      .gte("invoice_date", start)
      .lt("invoice_date", end)
      .returns<{ sku_id: string | null; account_id: string | null; qty: number; rate: number | null; invoice_date: string | null; invoice_no: string }[]>(),
    supabase
      .from("billing_requests")
      .select("sku_id, account_id, qty, amount, invoice_date")
      .eq("status", "billed")
      .gte("invoice_date", start)
      .lt("invoice_date", end)
      .returns<{ sku_id: string; account_id: string | null; qty: number; amount: number | null; invoice_date: string | null }[]>(),
    supabase
      .from("orders")
      .select("account_id, invoice_date, invoice_number, order_lines(sku_id, qty, net_price)")
      .eq("order_type", "saleable")
      .eq("status", "closed")
      .gte("invoice_date", start)
      .lt("invoice_date", end)
      .returns<
        { account_id: string | null; invoice_date: string | null; invoice_number: string | null; order_lines: { sku_id: string; qty: number; net_price: number | null }[] }[]
      >(),
  ]);

  const tallyLines = (tallyRowsRaw ?? []).filter((t) => inSelectedMonths(t.invoice_date));
  const billedConsignment = (billedRowsRaw ?? []).filter((b) => inSelectedMonths(b.invoice_date));
  const closedSaleable = (closedSaleableRowsRaw ?? []).filter((o) => inSelectedMonths(o.invoice_date));

  const skuRows = accountFilter
    ? (allSkuRows ?? []).filter((s) => s.accounts?.label.toLowerCase().includes(accountFilter))
    : allSkuRows ?? [];

  // Only counts qty from revenue-bearing lines (rate/amount/net_price > 0) --
  // a $0-rate line is a duplicate stock-tracking entry for the same
  // procedures already billed on a paired Licence line, not additional
  // units sold.
  const actualBySku = new Map<string, number>();
  function addActual(accountId: string | null, skuId: string | null, qty: number, revenue: number) {
    if (!accountId || !skuId || revenue <= 0) return;
    const key = `${accountId}|${skuId}`;
    actualBySku.set(key, (actualBySku.get(key) ?? 0) + (qty || 0));
  }
  tallyLines.forEach((t) => addActual(t.account_id, t.sku_id, t.qty, t.qty * (t.rate ?? 0)));
  billedConsignment.forEach((b) => addActual(b.account_id, b.sku_id, b.qty, b.amount ?? 0));
  const tallyInvoiceNos = new Set(tallyLines.map((t) => t.invoice_no));
  closedSaleable
    .filter((o) => !(o.invoice_number && tallyInvoiceNos.has(o.invoice_number)))
    .forEach((o) => o.order_lines.forEach((l) => addActual(o.account_id, l.sku_id, l.qty, l.qty * (l.net_price ?? 0))));

  function eligibleMonthCount(commitmentStart: string | null) {
    const eligible = commitmentStart ? months.filter((m) => m >= commitmentStart.slice(0, 7)) : months;
    return eligible.length || 1;
  }

  const hasAnyActual = (accountId: string, skuId: string) => (actualBySku.get(`${accountId}|${skuId}`) ?? 0) > 0;

  const rows = skuRows
    .filter((s) => s.commitment_per_month != null || hasAnyActual(s.account_id, s.id))
    .sort((a, b) => (a.accounts?.label ?? "").localeCompare(b.accounts?.label ?? "") || a.name.localeCompare(b.name));

  // No fixed "(xN months)" suffix on the header -- each account can have a
  // different eligible month count within the same selected range (commitment
  // start dates differ), so one label can't describe every row in a flat,
  // mixed-account table the way CommittedPanel's per-account section header can.
  const header = ["Account", "Product", "Committed / month", "Target", "Actual", "Target - Actual", "Achievement %"];
  const dataLines = rows.map((s) => {
    const monthCount = eligibleMonthCount(s.accounts?.commitment_start ?? null);
    const actual = (actualBySku.get(`${s.account_id}|${s.id}`) ?? 0) * (s.units_per_pack || 1);
    const target = s.commitment_per_month != null ? s.commitment_per_month * monthCount : null;
    const diff = target != null ? target - actual : "";
    const achievementPct = target ? Math.round((actual / target) * 100) : "";
    return [s.accounts?.label ?? "—", s.name, s.commitment_per_month ?? "", target ?? "", actual, diff, achievementPct];
  });

  const csv = [header, ...dataLines].map((line) => line.map(csvCell).join(",")).join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
