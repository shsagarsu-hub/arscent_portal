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

// Plain numeric month, per request -- ambiguous across a year boundary, but
// this feed is a rolling few-month tracker, not a multi-year archive.
function monthLabel(monthIso: string): number {
  return Number(monthIso.split("-")[1]);
}

interface MonthActuals {
  /** account_id|sku_id -> qty, the number that drives Committed/Diff/Remarks. */
  qtyMap: Map<string, number>;
  /** account_id|sku_id|location_id -> qty, for accounts whose placement is
   * tracked per branch (currently only LVPEI's consignment orders carry a
   * location_id) -- purely a breakdown of the total already in qtyMap, never
   * added on top of it. */
  locationQtyMap: Map<string, number>;
}

/** Actual qty booked for every account+sku, for one month, from the same
 * three real revenue sources RevenueMarginPanel uses (Tally invoices, billed
 * consignment, closed Saleable orders) -- qty only counts on a
 * revenue-bearing line, same rule that drops $0 duplicate stock-tracking
 * lines paired with a licence line -- PLUS closed long-term-consignment
 * orders (library stock physically placed at a hospital, e.g. LVPEI's CT
 * LUCIA lens library). Those orders have no invoice_date/invoice_number --
 * billing happens later, off a usage statement -- so they're bucketed by
 * dc_date instead and counted regardless of revenue: the commitment they're
 * tracked against ("units placed this month") is a physical-placement
 * target, not a billing one, so gating on revenue would hide real progress
 * that hasn't been invoiced yet. */
async function actualQtyForMonth(supabase: ReturnType<typeof createAdminClient>, month: string): Promise<MonthActuals> {
  const { start, end } = monthBounds(month);
  const [{ data: tallyRows }, { data: billedRows }, { data: closedRows }, { data: consignmentRows }] = await Promise.all([
    supabase
      .from("tally_invoice_lines")
      .select("sku_id, account_id, qty, rate, invoice_date, invoice_no")
      .eq("document_type", "invoice")
      .gte("invoice_date", start)
      .lt("invoice_date", end)
      .returns<{ sku_id: string | null; account_id: string | null; qty: number; rate: number | null; invoice_date: string; invoice_no: string }[]>(),
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
    supabase
      .from("orders")
      .select("account_id, location_id, dc_date, order_lines(sku_id, qty)")
      .eq("order_type", "long_term_consignment")
      .eq("status", "closed")
      .gte("dc_date", start)
      .lt("dc_date", end)
      .returns<{ account_id: string | null; location_id: string | null; dc_date: string | null; order_lines: { sku_id: string; qty: number }[] }[]>(),
  ]);

  const qtyMap = new Map<string, number>();
  const locationQtyMap = new Map<string, number>();
  function add(accountId: string | null, skuId: string | null, qty: number, revenue: number) {
    if (!accountId || !skuId || revenue <= 0) return;
    const key = `${accountId}|${skuId}`;
    qtyMap.set(key, (qtyMap.get(key) ?? 0) + (qty || 0));
  }
  (tallyRows ?? []).forEach((t) => add(t.account_id, t.sku_id, t.qty, t.qty * (t.rate ?? 0)));
  (billedRows ?? []).forEach((b) => add(b.account_id, b.sku_id, b.qty, b.amount ?? 0));
  const tallyInvoiceNos = new Set((tallyRows ?? []).map((t) => t.invoice_no));
  (closedRows ?? [])
    .filter((o) => !(o.invoice_number && tallyInvoiceNos.has(o.invoice_number)))
    .forEach((o) => o.order_lines.forEach((l) => add(o.account_id, l.sku_id, l.qty, l.qty * (l.net_price ?? 0))));
  (consignmentRows ?? []).forEach((o) => {
    if (!o.account_id) return;
    o.order_lines.forEach((l) => {
      const key = `${o.account_id}|${l.sku_id}`;
      qtyMap.set(key, (qtyMap.get(key) ?? 0) + (l.qty || 0));
      if (o.location_id) {
        const locKey = `${key}|${o.location_id}`;
        locationQtyMap.set(locKey, (locationQtyMap.get(locKey) ?? 0) + (l.qty || 0));
      }
    });
  });
  return { qtyMap, locationQtyMap };
}

/**
 * A Google Sheet's IMPORTDATA can't send an auth header or cookie -- it's a
 * plain unauthenticated GET -- so this route is gated by a shared-secret
 * query token instead of the usual signed-in-profile check every other
 * privileged read in this app uses before reaching for createAdminClient().
 *
 * Wide, one-row-per-SKU layout with one Actual/Committed/Diff/Remarks block
 * per requested month (?months=2026-08,2026-09,2026-10, comma-separated;
 * defaults to the current month alone) -- a plain CSV can't produce a
 * merged spanning header, so the month label repeats only in that block's
 * first column, close enough to merge by hand once in Sheets if wanted.
 *
 * ?account=<substring> scopes the whole feed to one account (case-insensitive
 * match against the account's label) -- so three separate IMPORTDATA calls,
 * each with a different account filter, can each land in their own box on
 * the same sheet instead of one long mixed table.
 *
 * ?breakdown=locations switches to a SEPARATE, smaller feed: one row per
 * account+SKU+branch (Actual only, no Committed/Diff/Remarks -- a commitment
 * target belongs to the account+SKU as a whole, not to one branch of it).
 * This must stay a distinct mode rather than extra rows inlined into the
 * normal feed: a downstream sheet's box formulas often pull an exact cell or
 * range by position, and any month where a branch account (e.g. LVPEI) picks
 * up or drops a location shifts every row below it in the normal feed --
 * every other account's numbers included, since sorting is alphabetical by
 * account label. That happened once already; this mode exists so branch
 * detail can live in its own box without ever moving anyone else's row.
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
  const breakdown = url.searchParams.get("breakdown");

  const supabase = createAdminClient();

  const [{ data: allSkuRows }, { data: locationRows }] = await Promise.all([
    supabase
      .from("skus")
      .select("id, name, account_id, commitment_per_month, units_per_pack, accounts(label, commitment_start)")
      .returns<SkuRow[]>(),
    supabase.from("account_locations").select("id, name").returns<{ id: string; name: string }[]>(),
  ]);
  const locationNames = new Map((locationRows ?? []).map((l) => [l.id, l.name]));
  const skuRows = accountFilter
    ? (allSkuRows ?? []).filter((s) => s.accounts?.label.toLowerCase().includes(accountFilter))
    : allSkuRows;

  // SKUs with no commitment target and no actual booking in ANY requested
  // month are noise on a tracker meant to flag surplus/shortfall -- dropped
  // the same way the single-month version already did.
  const qtyByMonth = new Map<string, MonthActuals>();
  for (const month of months) {
    qtyByMonth.set(month, await actualQtyForMonth(supabase, month));
  }
  const hasAnyActual = (accountId: string, skuId: string) =>
    months.some((m) => (qtyByMonth.get(m)?.qtyMap.get(`${accountId}|${skuId}`) ?? 0) > 0);

  const rows = (skuRows ?? [])
    .filter((s) => s.commitment_per_month != null || hasAnyActual(s.account_id, s.id))
    .sort((a, b) => (a.accounts?.label ?? "").localeCompare(b.accounts?.label ?? "") || a.name.localeCompare(b.name));

  let csv: string;
  if (breakdown === "locations") {
    const header: (string | number)[] = ["Account", "Branch", "Product"];
    for (const month of months) header.push(monthLabel(month));
    const branchLines = rows.flatMap((s) => {
      const locationIds = new Set<string>();
      for (const month of months) {
        for (const key of qtyByMonth.get(month)?.locationQtyMap.keys() ?? []) {
          if (key.startsWith(`${s.account_id}|${s.id}|`)) locationIds.add(key.split("|")[2]);
        }
      }
      return Array.from(locationIds)
        .sort((a, b) => (locationNames.get(a) ?? "").localeCompare(locationNames.get(b) ?? ""))
        .map((locId) => {
          const line: (string | number)[] = [s.accounts?.label ?? "—", locationNames.get(locId) ?? "Unknown branch", s.name];
          for (const month of months) {
            const placedQty = qtyByMonth.get(month)?.locationQtyMap.get(`${s.account_id}|${s.id}|${locId}`) ?? 0;
            line.push(placedQty * (s.units_per_pack || 1));
          }
          return line;
        });
    });
    csv = [header, ...branchLines].map((line) => line.map(csvCell).join(",")).join("\n");
  } else {
    const header1: (string | number)[] = ["", ""];
    const header2: (string | number)[] = ["Account", "Product"];
    for (const month of months) {
      header1.push(monthLabel(month), "", "", "");
      header2.push("Actual", "Committed", "Diff", "Remarks");
    }

    const dataLines = rows.map((s) => {
      const line: (string | number)[] = [s.accounts?.label ?? "—", s.name];
      for (const month of months) {
        const eligible = !s.accounts?.commitment_start || s.accounts.commitment_start.slice(0, 7) <= month;
        const committedQty = eligible ? s.commitment_per_month ?? 0 : 0;
        // Matches CommittedPanel.tsx's own math exactly: raw booked qty is in
        // packs, commitment_per_month is a per-unit target, so this needs the
        // same units_per_pack conversion the portal's own panel applies --
        // otherwise this feed silently disagreed with the number in the app.
        const actualQty = (qtyByMonth.get(month)?.qtyMap.get(`${s.account_id}|${s.id}`) ?? 0) * (s.units_per_pack || 1);
        const diff = actualQty - committedQty;
        const remarks = diff > 0 ? "Surplus" : diff < 0 ? "Shortfall" : "On Target";
        line.push(actualQty, committedQty, diff, remarks);
      }
      return line;
    });

    csv = [header1, header2, ...dataLines].map((line) => line.map(csvCell).join(",")).join("\n");
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
