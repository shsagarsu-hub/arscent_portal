import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthBounds, thisMonthISO } from "@/lib/dates";

interface SkuRow {
  id: string;
  name: string;
  account_id: string;
  price_ex_gst: number | null;
  commitment_per_month: number | null;
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
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!process.env.REPORTS_API_TOKEN || token !== process.env.REPORTS_API_TOKEN) {
    return new Response("Not authorized.", { status: 401 });
  }

  const month = url.searchParams.get("month") || thisMonthISO();
  const { start, end } = monthBounds(month);

  const supabase = createAdminClient();

  // Same three real revenue sources, same per-line formula, and the same
  // account_id+sku_id keying (not sku_id alone) as RevenueMarginPanel --
  // keying by the invoice's own account_id keeps a fuzzy Tally-description
  // match on a similarly-named SKU from crediting revenue to the wrong
  // account.
  const [{ data: skuRows }, { data: tallyRows }, { data: billedRows }, { data: closedRows }] = await Promise.all([
    supabase
      .from("skus")
      .select("id, name, account_id, price_ex_gst, commitment_per_month, accounts(label, commitment_start)")
      .returns<SkuRow[]>(),
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
  ]);

  const qtyMap = new Map<string, number>();
  const revMap = new Map<string, number>();
  function add(accountId: string | null, skuId: string | null, qty: number, revenue: number) {
    if (!accountId || !skuId) return;
    const key = `${accountId}|${skuId}`;
    revMap.set(key, (revMap.get(key) ?? 0) + (revenue || 0));
    if (revenue > 0) qtyMap.set(key, (qtyMap.get(key) ?? 0) + (qty || 0));
  }
  (tallyRows ?? []).forEach((t) => add(t.account_id, t.sku_id, t.qty, t.qty * (t.rate ?? 0)));
  (billedRows ?? []).forEach((b) => add(b.account_id, b.sku_id, b.qty, b.amount ?? 0));
  const tallyInvoiceNos = new Set((tallyRows ?? []).map((t) => t.invoice_no));
  (closedRows ?? [])
    .filter((o) => !(o.invoice_number && tallyInvoiceNos.has(o.invoice_number)))
    .forEach((o) => o.order_lines.forEach((l) => add(o.account_id, l.sku_id, l.qty, l.qty * (l.net_price ?? 0))));

  // Committed target is 0 for a month before the account's own
  // commitment_start -- same eligibility rule RevenueMarginPanel uses -- so
  // an account that hasn't started its commitment term yet doesn't show a
  // false shortfall.
  const rows = (skuRows ?? [])
    .filter((s) => s.commitment_per_month != null || (qtyMap.get(`${s.account_id}|${s.id}`) ?? 0) > 0)
    .map((s) => {
      const key = `${s.account_id}|${s.id}`;
      const eligible = !s.accounts?.commitment_start || s.accounts.commitment_start.slice(0, 7) <= month;
      const committedQty = eligible ? s.commitment_per_month ?? 0 : 0;
      const actualQty = qtyMap.get(key) ?? 0;
      const committedRevenue = committedQty * (s.price_ex_gst ?? 0);
      const actualRevenue = revMap.get(key) ?? 0;
      return {
        month,
        account: s.accounts?.label ?? "—",
        product: s.name,
        committedQty,
        actualQty,
        varianceQty: actualQty - committedQty,
        committedRevenue: Math.round(committedRevenue * 100) / 100,
        actualRevenue: Math.round(actualRevenue * 100) / 100,
      };
    })
    .sort((a, b) => a.account.localeCompare(b.account) || a.product.localeCompare(b.product));

  const header = ["Month", "Account", "Product", "Committed Qty", "Actual Qty", "Variance Qty", "Committed Revenue (ex GST)", "Actual Revenue (ex GST)"];
  const lines = [header, ...rows.map((r) => [r.month, r.account, r.product, r.committedQty, r.actualQty, r.varianceQty, r.committedRevenue, r.actualRevenue])];
  const csv = lines.map((line) => line.map(csvCell).join(",")).join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
