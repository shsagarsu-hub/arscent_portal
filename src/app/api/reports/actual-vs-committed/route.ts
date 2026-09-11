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

interface CreditNoteRow {
  sku_id: string | null;
  account_id: string | null;
  item_id: string | null;
  qty: number;
  rate: number | null;
  related_invoice_no: string | null;
}

/** Actual qty booked for every account+sku, for one calendar month, from the
 * exact same three sources and revenue-gating ManagerPortal.tsx's actualBySku
 * uses (Tally invoices, billed consignment, closed Saleable orders) -- no
 * separate logic of this feed's own. An earlier version also counted closed
 * long_term_consignment orders (LVPEI's CT LUCIA library) since those don't
 * carry an invoice_date/invoice_number either -- that made this feed diverge
 * from what the app itself shows (LVPEI read 500 here, 0 on screen), so it's
 * gone: if ManagerPortal doesn't count it, this feed doesn't either.
 *
 * `allCreditNotes` is passed in already fetched (not re-queried per month --
 * there are only a handful company-wide) so a credit note issued in a LATER
 * month than its own original invoice still nets against the invoice's own
 * month here: it's matched to this month's tallyRows by related_invoice_no +
 * item_id, not by the credit note's own invoice_date. Only a genuine
 * full-value reversal counts (credit note rate exactly cancels the original
 * line's rate) -- a flat/partial discount (e.g. a real one here: -Rs.5,000
 * off a Rs.41,904.76 line) never matches, so qty stays untouched for it. */
async function actualQtyForMonth(supabase: ReturnType<typeof createAdminClient>, month: string, allCreditNotes: CreditNoteRow[]) {
  const { start, end } = monthBounds(month);
  const [{ data: tallyRows }, { data: billedRows }, { data: closedRows }] = await Promise.all([
    supabase
      .from("tally_invoice_lines")
      .select("sku_id, account_id, item_id, qty, rate, invoice_date, invoice_no")
      .eq("document_type", "invoice")
      .gte("invoice_date", start)
      .lt("invoice_date", end)
      .returns<{ sku_id: string | null; account_id: string | null; item_id: string | null; qty: number; rate: number | null; invoice_date: string; invoice_no: string }[]>(),
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

  const qtyMap = new Map<string, number>();
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

  const rateByInvoiceItem = new Map<string, number>();
  (tallyRows ?? []).forEach((t) => {
    if (t.item_id) rateByInvoiceItem.set(`${t.invoice_no}|${t.item_id}`, t.rate ?? 0);
  });
  allCreditNotes.forEach((c) => {
    if (!c.account_id || !c.sku_id || !c.item_id || !c.related_invoice_no) return;
    const originalRate = rateByInvoiceItem.get(`${c.related_invoice_no}|${c.item_id}`);
    if (originalRate == null) return; // original invoice isn't in THIS month -- not this month's adjustment
    const isFullReversal = Math.abs((c.rate ?? 0) + originalRate) < 0.01;
    if (!isFullReversal) return;
    const key = `${c.account_id}|${c.sku_id}`;
    qtyMap.set(key, (qtyMap.get(key) ?? 0) - c.qty);
  });

  return qtyMap;
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
 * first column.
 *
 * Each month's block is that single calendar month's own Actual and
 * Committed, computed independently -- NOT the cumulative-across-selected-
 * months figure the portal's own CommittedPanel shows for its "Target (xN
 * months)" column. An invoice from a month outside the two/three requested
 * here won't appear in any column, by design, since a per-month breakdown
 * has nowhere to put it. If a number here looks lower than the portal's
 * on-screen Actual, check which months the portal currently has selected --
 * that number is a sum across all of them, this is separated per month.
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

  const [{ data: allSkuRows }, { data: creditNoteRows }] = await Promise.all([
    supabase
      .from("skus")
      .select("id, name, account_id, commitment_per_month, units_per_pack, accounts(label, commitment_start)")
      .returns<SkuRow[]>(),
    // Fetched once, unfiltered by date -- there are only a handful of credit
    // notes company-wide, and one can be dated well after the invoice it
    // corrects, so it can't be scoped to any single month's window up front.
    supabase
      .from("tally_invoice_lines")
      .select("sku_id, account_id, item_id, qty, rate, related_invoice_no")
      .eq("document_type", "credit_note")
      .returns<CreditNoteRow[]>(),
  ]);
  const skuRows = accountFilter
    ? (allSkuRows ?? []).filter((s) => s.accounts?.label.toLowerCase().includes(accountFilter))
    : allSkuRows;

  // SKUs with no commitment target and no actual booking in ANY requested
  // month are noise on a tracker meant to flag surplus/shortfall -- dropped
  // the same way the single-month version already did.
  const qtyByMonth = new Map<string, Map<string, number>>();
  for (const month of months) {
    qtyByMonth.set(month, await actualQtyForMonth(supabase, month, creditNoteRows ?? []));
  }
  const hasAnyActual = (accountId: string, skuId: string) =>
    months.some((m) => (qtyByMonth.get(m)?.get(`${accountId}|${skuId}`) ?? 0) > 0);

  const rows = (skuRows ?? [])
    .filter((s) => s.commitment_per_month != null || hasAnyActual(s.account_id, s.id))
    .sort((a, b) => (a.accounts?.label ?? "").localeCompare(b.accounts?.label ?? "") || a.name.localeCompare(b.name));

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
      // Raw booked qty is in packs; commitment_per_month is quoted per single
      // procedure/unit -- matches CommittedPanel's own units_per_pack conversion.
      const actualQty = (qtyByMonth.get(month)?.get(`${s.account_id}|${s.id}`) ?? 0) * (s.units_per_pack || 1);
      const diff = actualQty - committedQty;
      const remarks = diff > 0 ? "Surplus" : diff < 0 ? "Shortfall" : "On Target";
      line.push(actualQty, committedQty, diff, remarks);
    }
    return line;
  });

  const csv = [header1, header2, ...dataLines].map((line) => line.map(csvCell).join(",")).join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
