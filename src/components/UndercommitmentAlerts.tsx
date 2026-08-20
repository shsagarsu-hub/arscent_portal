"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { monthBounds } from "@/lib/dates";

interface SkuRow {
  id: string;
  commitment_per_month: number | null;
  account_id: string;
  accounts: { label: string; commitment_start: string | null } | null;
}

interface FlaggedAccount {
  accountId: string;
  label: string;
  months: { month: string; pct: number }[];
}

/** Oldest to newest, strictly BEFORE the current month -- a still-in-progress
 * current month hasn't had a chance to catch up yet, so including it would
 * flag every account on the 1st of every month regardless of how they
 * actually did. */
function lastNCompletedMonths(n: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Independent of whatever month range the Dashboard/Vs Committed picker has
 * selected -- this always looks at the same fixed trailing 3 completed
 * months, since "has this account been under every month lately" is a
 * different question than "how did this account do in the period I'm
 * currently viewing." Flags an account only if its committed-SKU average
 * achievement (same avg-of-per-SKU-ratios method Vs Committed's own account
 * header badge uses, just one month at a time instead of scaled across a
 * range) came in under 100% in EVERY one of the 3 months, not just on
 * average across them -- one strong month mixed into an otherwise-weak
 * quarter shouldn't trip the alarm.
 */
export function UndercommitmentAlerts() {
  const supabase = createClient();
  const [flagged, setFlagged] = useState<FlaggedAccount[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      const months = lastNCompletedMonths(3);
      const start = monthBounds(months[0]).start;
      const end = monthBounds(months[months.length - 1]).end;

      const [{ data: skuRows }, { data: tallyRows }, { data: billedRows }, { data: closedRows }] = await Promise.all([
        supabase
          .from("skus")
          .select("id, commitment_per_month, account_id, accounts(label, commitment_start)")
          .returns<SkuRow[]>(),
        supabase
          .from("tally_invoice_lines")
          .select("sku_id, qty, invoice_date")
          .eq("document_type", "invoice")
          .gte("invoice_date", start)
          .lt("invoice_date", end)
          .returns<{ sku_id: string | null; qty: number; invoice_date: string }[]>(),
        supabase
          .from("billing_requests")
          .select("sku_id, qty, invoice_date")
          .eq("status", "billed")
          .gte("invoice_date", start)
          .lt("invoice_date", end)
          .returns<{ sku_id: string; qty: number; invoice_date: string | null }[]>(),
        supabase
          .from("orders")
          .select("invoice_date, order_lines(sku_id, qty)")
          .eq("order_type", "saleable")
          .eq("status", "closed")
          .gte("invoice_date", start)
          .lt("invoice_date", end)
          .returns<{ invoice_date: string | null; order_lines: { sku_id: string; qty: number }[] }[]>(),
      ]);

      // actual qty per (sku, month) -- unlike the Dashboard/Vs Committed
      // load(), which sums a whole selected range into one number per SKU,
      // the per-month check below needs each month's figure kept separate.
      const actualBySkuMonth = new Map<string, number>();
      function addActual(skuId: string | null, dateIso: string | null, qty: number) {
        if (!skuId || !dateIso) return;
        const month = dateIso.slice(0, 7);
        if (!months.includes(month)) return;
        const key = `${skuId}|${month}`;
        actualBySkuMonth.set(key, (actualBySkuMonth.get(key) ?? 0) + (qty || 0));
      }
      (tallyRows ?? []).forEach((t) => addActual(t.sku_id, t.invoice_date, t.qty));
      (billedRows ?? []).forEach((b) => addActual(b.sku_id, b.invoice_date, b.qty));
      (closedRows ?? []).forEach((o) => o.order_lines.forEach((l) => addActual(l.sku_id, o.invoice_date, l.qty)));

      const accounts = new Map<string, { label: string; commitmentStart: string | null }>();
      (skuRows ?? []).forEach((s) => {
        if (!accounts.has(s.account_id)) {
          accounts.set(s.account_id, { label: s.accounts?.label ?? "—", commitmentStart: s.accounts?.commitment_start ?? null });
        }
      });

      const result: FlaggedAccount[] = [];
      for (const [accountId, acct] of accounts) {
        const committedSkus = (skuRows ?? []).filter((s) => s.account_id === accountId && s.commitment_per_month);
        if (committedSkus.length === 0) continue;

        const monthPcts: { month: string; pct: number }[] = [];
        let eligibleThroughout = true;
        for (const month of months) {
          // An account not yet under commitment in a given month can't be
          // judged for it -- skip the whole account rather than count a
          // pre-commitment month as "under".
          if (acct.commitmentStart && month < acct.commitmentStart.slice(0, 7)) {
            eligibleThroughout = false;
            break;
          }
          const ratios = committedSkus.map((s) => {
            const actual = actualBySkuMonth.get(`${s.id}|${month}`) ?? 0;
            return actual / (s.commitment_per_month as number);
          });
          const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
          monthPcts.push({ month, pct: avg });
        }

        if (eligibleThroughout && monthPcts.length === months.length && monthPcts.every((m) => m.pct < 1)) {
          result.push({ accountId, label: acct.label, months: monthPcts });
        }
      }

      setFlagged(result);
    })();
  }, [supabase]);

  if (!flagged || flagged.length === 0) return null;
  const visible = flagged.filter((f) => !dismissed.has(f.accountId));
  if (visible.length === 0) return null;

  return (
    <div className="card border-bad-fg bg-[#fdecec]">
      <h3 className="mb-1 text-[14.5px] font-extrabold text-bad-fg">
        ⚠ Under commitment 3 months running
      </h3>
      <p className="mb-3.5 text-xs text-ink-soft">
        These accounts have come in below their committed target every month for the last 3 completed months.
      </p>
      <div className="space-y-2">
        {visible.map((f) => (
          <div key={f.accountId} className="flex items-center justify-between rounded-[4px] border border-bad-fg/30 bg-card px-3 py-2">
            <div>
              <span className="text-[13px] font-bold text-ink">{f.label}</span>
              <span className="ml-2 text-[11px] text-muted">
                {f.months.map((m) => `${m.month}: ${Math.round(m.pct * 100)}%`).join(" · ")}
              </span>
            </div>
            <button
              type="button"
              className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
              onClick={() => setDismissed((prev) => new Set(prev).add(f.accountId))}
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
