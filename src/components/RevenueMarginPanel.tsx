"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "./AppShell";
import { MonthMultiSelect } from "./MonthMultiSelect";
import { monthBounds, thisMonthISO } from "@/lib/dates";

interface SkuRow {
  id: string;
  name: string;
  account_id: string;
  price_ex_gst: number | null;
  transfer_price: number | null;
  commitment_per_month: number | null;
  accounts: { label: string; commitment_start: string | null } | null;
}

function inr(n: number) {
  const sign = n < 0 ? "−" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function inrOrDash(n: number) {
  return n === 0 ? "–" : inr(n);
}

/**
 * Actual Revenue/Margin here uses the exact same three real sources (and the
 * exact same per-line revenue formula) as Dashboard's own Revenue Booked --
 * confirmed Tally invoices (qty * rate), billed consignment (its own
 * precomputed amount), and closed Saleable orders (qty * net_price) -- kept
 * as a separate self-contained fetch rather than reusing Dashboard's own
 * query only because this one also needs sku_id (to join transfer_price)
 * and Dashboard's never selected that.
 *
 * Committed Revenue/Margin are a target, not an invoice -- commitment_per_
 * month (units) * price_ex_gst (revenue) / transfer_price (cost), the same
 * per-SKU numbers Vs Committed already tracks, scaled by however many
 * selected months the account was actually under commitment for (same
 * eligibleMonthCount logic as CommittedPanel).
 */
export function RevenueMarginPanel() {
  const supabase = createClient();
  const [skus, setSkus] = useState<SkuRow[] | null>(null);
  const [months, setMonths] = useState<string[]>(() => [thisMonthISO()]);
  const [accountFilter, setAccountFilter] = useState("");
  const [actualQty, setActualQty] = useState<Map<string, number>>(new Map());
  const [actualRevenue, setActualRevenue] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    void (async () => {
      const sortedMonths = months.slice().sort();
      const start = monthBounds(sortedMonths[0]).start;
      const end = monthBounds(sortedMonths[sortedMonths.length - 1]).end;
      const monthSet = new Set(months);
      const inSelectedMonths = (d: string | null) => !!d && monthSet.has(d.slice(0, 7));

      const [{ data: skuRows }, { data: tallyRows }, { data: billedRows }, { data: closedRows }] = await Promise.all([
        supabase
          .from("skus")
          .select("id, name, account_id, price_ex_gst, transfer_price, commitment_per_month, accounts(label, commitment_start)")
          .returns<SkuRow[]>(),
        supabase
          .from("tally_invoice_lines")
          .select("sku_id, account_id, qty, rate, invoice_date")
          .eq("document_type", "invoice")
          .gte("invoice_date", start)
          .lt("invoice_date", end)
          .returns<{ sku_id: string | null; account_id: string | null; qty: number; rate: number | null; invoice_date: string }[]>(),
        supabase
          .from("billing_requests")
          .select("sku_id, account_id, qty, amount, invoice_date")
          .eq("status", "billed")
          .gte("invoice_date", start)
          .lt("invoice_date", end)
          .returns<{ sku_id: string; account_id: string | null; qty: number; amount: number | null; invoice_date: string | null }[]>(),
        supabase
          .from("orders")
          .select("account_id, invoice_date, order_lines(sku_id, qty, net_price)")
          .eq("order_type", "saleable")
          .eq("status", "closed")
          .gte("invoice_date", start)
          .lt("invoice_date", end)
          .returns<
            { account_id: string | null; invoice_date: string | null; order_lines: { sku_id: string; qty: number; net_price: number | null }[] }[]
          >(),
      ]);

      // Keyed by account_id + sku_id together, not sku_id alone -- a Tally
      // description can fuzzy-match a similarly-named SKU that belongs to a
      // DIFFERENT account (confirmed on a real invoice: a Rajajinagar line
      // matched an unrelated Bommasandra SKU, inflating Bommasandra's actual
      // revenue by ~19L that was never actually billed to it). Keying by the
      // invoice's own account_id, not the matched SKU's account_id, keeps a
      // bad match from crediting revenue to the wrong account.
      const qtyMap = new Map<string, number>();
      const revMap = new Map<string, number>();
      function add(accountId: string | null, skuId: string | null, dateIso: string | null, qty: number, revenue: number) {
        if (!accountId || !skuId || !inSelectedMonths(dateIso)) return;
        const key = `${accountId}|${skuId}`;
        qtyMap.set(key, (qtyMap.get(key) ?? 0) + (qty || 0));
        revMap.set(key, (revMap.get(key) ?? 0) + (revenue || 0));
      }
      (tallyRows ?? []).forEach((t) => add(t.account_id, t.sku_id, t.invoice_date, t.qty, t.qty * (t.rate ?? 0)));
      (billedRows ?? []).forEach((b) => add(b.account_id, b.sku_id, b.invoice_date, b.qty, b.amount ?? 0));
      (closedRows ?? []).forEach((o) =>
        o.order_lines.forEach((l) => add(o.account_id, l.sku_id, o.invoice_date, l.qty, l.qty * (l.net_price ?? 0)))
      );

      setSkus(skuRows ?? []);
      setActualQty(qtyMap);
      setActualRevenue(revMap);
    })();
  }, [months, supabase]);

  const accounts = useMemo(() => {
    if (!skus) return [];
    const map = new Map<string, { id: string; label: string; commitmentStart: string | null }>();
    skus.forEach((s) =>
      map.set(s.account_id, { id: s.account_id, label: s.accounts?.label ?? "—", commitmentStart: s.accounts?.commitment_start ?? null })
    );
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [skus]);

  /**
   * Only gates the *committed* target -- an account with no eligible months
   * yet hasn't earned a commitment target, so committed figures should be 0,
   * not silently defaulted to 1 month's worth. Actual revenue/margin must
   * never be gated by this: a sale can and does happen before an account's
   * official commitment_start (e.g. a pilot order), and dropping the whole
   * account from actuals because it isn't "eligible" yet was the bug here --
   * real invoiced revenue went missing from the total.
   */
  function eligibleMonthCount(commitmentStart: string | null) {
    const eligible = commitmentStart ? months.filter((m) => m >= commitmentStart.slice(0, 7)) : months;
    return eligible.length;
  }

  interface Figures {
    actualRevenue: number;
    committedRevenue: number;
    actualCost: number;
    committedCost: number;
  }

  function accountFigures(accountId: string, monthCount: number): Figures {
    const accountSkus = (skus ?? []).filter((s) => s.account_id === accountId);
    let fig: Figures = { actualRevenue: 0, committedRevenue: 0, actualCost: 0, committedCost: 0 };
    accountSkus.forEach((s) => {
      const key = `${accountId}|${s.id}`;
      const qty = actualQty.get(key) ?? 0;
      fig.actualRevenue += actualRevenue.get(key) ?? 0;
      fig.actualCost += qty * (s.transfer_price ?? 0);
      if (s.commitment_per_month) {
        const targetQty = s.commitment_per_month * monthCount;
        fig.committedRevenue += targetQty * (s.price_ex_gst ?? 0);
        fig.committedCost += targetQty * (s.transfer_price ?? 0);
      }
    });
    return fig;
  }

  const visibleAccounts = accountFilter ? accounts.filter((a) => a.id === accountFilter) : accounts;

  const totals = visibleAccounts.reduce(
    (acc, a) => {
      const fig = accountFigures(a.id, eligibleMonthCount(a.commitmentStart));
      acc.actualRevenue += fig.actualRevenue;
      acc.committedRevenue += fig.committedRevenue;
      acc.actualMargin += fig.actualRevenue - fig.actualCost;
      acc.committedMargin += fig.committedRevenue - fig.committedCost;
      return acc;
    },
    { actualRevenue: 0, committedRevenue: 0, actualMargin: 0, committedMargin: 0 }
  );

  const skuCount = skus?.length ?? 0;
  const withTransferPrice = (skus ?? []).filter((s) => s.transfer_price !== null).length;

  /**
   * Same figures as accountFigures, but rolled up by product name instead of
   * by account -- the same product (e.g. CT LUCIA) is sold under several
   * accounts, and seeing actual vs committed side by side per product is
   * what actually explains a large actual/committed gap (e.g. a product
   * selling far above its monthly commitment, or an account not yet
   * eligible dragging committed to zero while actual still books).
   */
  const productFigures = new Map<string, Figures>();
  visibleAccounts.forEach((a) => {
    const monthCount = eligibleMonthCount(a.commitmentStart);
    (skus ?? [])
      .filter((s) => s.account_id === a.id)
      .forEach((s) => {
        const key = `${a.id}|${s.id}`;
        const qty = actualQty.get(key) ?? 0;
        const cur = productFigures.get(s.name) ?? { actualRevenue: 0, committedRevenue: 0, actualCost: 0, committedCost: 0 };
        cur.actualRevenue += actualRevenue.get(key) ?? 0;
        cur.actualCost += qty * (s.transfer_price ?? 0);
        if (s.commitment_per_month) {
          const targetQty = s.commitment_per_month * monthCount;
          cur.committedRevenue += targetQty * (s.price_ex_gst ?? 0);
          cur.committedCost += targetQty * (s.transfer_price ?? 0);
        }
        productFigures.set(s.name, cur);
      });
  });
  const productNames = Array.from(productFigures.keys()).sort((a, b) => a.localeCompare(b));

  if (skus === null) return <Loading />;

  return (
    <div className="card">
      <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Revenue &amp; gross margin</h3>
      <p className="mb-3.5 text-xs text-muted">
        Actual comes from confirmed Tally invoices, billed consignment, and closed Saleable orders — the same data
        behind Revenue Booked above. Committed is commitment × price target, scaled to the months selected. Margin
        uses each product&apos;s transfer price (set in Accounts) as cost.
      </p>

      {skuCount > 0 && withTransferPrice < skuCount && (
        <p className="mb-3.5 rounded-[4px] border border-watch-fg/30 bg-[#fef3e2] px-3 py-2 text-[11.5px] font-semibold text-watch-fg">
          Transfer price is set for {withTransferPrice} of {skuCount} products — margin is understated until the rest
          are filled in on the Accounts tab.
        </p>
      )}

      <div className="mb-3.5 flex flex-wrap gap-3">
        <div>
          <label className="field-label">Month</label>
          <MonthMultiSelect months={months} onChange={setMonths} />
        </div>
      </div>

      {accounts.length === 0 ? (
        <Empty title="No accounts found" body="Add products under an account in the Accounts tab to see revenue and margin here." />
      ) : (
        <>
          <div className="mb-3.5 flex items-end justify-between gap-3">
            <h4 className="text-[13px] font-extrabold text-ink">By product — actual vs committed P&amp;L</h4>
            <div className="max-w-[260px] flex-1">
              <label className="field-label">Client</label>
              <select className="field-input" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mb-3 text-xs text-muted">
            Actual comes from confirmed Tally invoices, billed consignment, and closed Saleable orders; Committed is
            commitment × price target, scaled to the months selected. A large gap here usually means a product
            running well above (or below) its monthly commitment, or an account not yet eligible holding Committed at
            zero while Actual still books.
          </p>
          <div className="overflow-x-auto">
            <table className="u-table">
              <thead>
                <tr>
                  <th>Line item</th>
                  <th className="text-right">Actual</th>
                  <th className="text-right">Committed</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={3} className="bg-app/60 font-extrabold text-ink">
                    Revenue
                  </td>
                </tr>
                {productNames.map((name) => {
                  const fig = productFigures.get(name)!;
                  return (
                    <tr key={`rev-${name}`}>
                      <td className="pl-5 text-muted">{name}</td>
                      <td className="text-right">{inrOrDash(fig.actualRevenue)}</td>
                      <td className="text-right">{inrOrDash(fig.committedRevenue)}</td>
                    </tr>
                  );
                })}
                <tr className="font-extrabold text-ink">
                  <td>Total Revenue</td>
                  <td className="text-right">{inr(totals.actualRevenue)}</td>
                  <td className="text-right">{inr(totals.committedRevenue)}</td>
                </tr>

                <tr>
                  <td colSpan={3} className="bg-app/60 pt-4 font-extrabold text-ink">
                    Cost of Goods Sold
                  </td>
                </tr>
                {productNames.map((name) => {
                  const fig = productFigures.get(name)!;
                  return (
                    <tr key={`cogs-${name}`}>
                      <td className="pl-5 text-muted">{name}</td>
                      <td className="text-right">{inrOrDash(fig.actualCost)}</td>
                      <td className="text-right">{inrOrDash(fig.committedCost)}</td>
                    </tr>
                  );
                })}
                {(() => {
                  const totalActualCost = productNames.reduce((a, n) => a + productFigures.get(n)!.actualCost, 0);
                  const totalCommittedCost = productNames.reduce((a, n) => a + productFigures.get(n)!.committedCost, 0);
                  return (
                    <tr className="font-extrabold text-ink">
                      <td>Total COGS</td>
                      <td className="text-right">{inr(totalActualCost)}</td>
                      <td className="text-right">{inr(totalCommittedCost)}</td>
                    </tr>
                  );
                })()}

                <tr className="font-extrabold text-ink">
                  <td className="pt-4">Gross Margin (₹)</td>
                  <td className={`pt-4 text-right ${totals.actualMargin < 0 ? "text-bad-fg" : ""}`}>{inr(totals.actualMargin)}</td>
                  <td className={`pt-4 text-right ${totals.committedMargin < 0 ? "text-bad-fg" : ""}`}>{inr(totals.committedMargin)}</td>
                </tr>
                <tr className="italic text-muted">
                  <td>Gross Margin %</td>
                  <td className="text-right">
                    {totals.actualRevenue !== 0 ? `${((totals.actualMargin / totals.actualRevenue) * 100).toFixed(1)}%` : "–"}
                  </td>
                  <td className="text-right">
                    {totals.committedRevenue !== 0 ? `${((totals.committedMargin / totals.committedRevenue) * 100).toFixed(1)}%` : "–"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
