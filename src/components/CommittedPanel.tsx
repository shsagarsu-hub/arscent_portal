"use client";

import { useMemo, useState } from "react";
import { Empty } from "./AppShell";

interface SkuRow {
  id: string;
  name: string;
  commitment_per_month: number | null;
  account_id: string;
  accounts: { label: string; commitment_start: string | null } | null;
}

function achievementBadge(pct: number | null) {
  if (pct === null) return <span className="badge badge-neutral">n/a</span>;
  const cls = pct >= 1 ? "badge-good" : pct >= 0.85 ? "badge-watch" : "badge-bad";
  return <span className={`badge ${cls}`}>{Math.round(pct * 100)}%</span>;
}

function diffCell(committed: number | null, actual: number) {
  if (committed === null) return <span className="text-muted">—</span>;
  const diff = committed - actual;
  if (diff <= 0) return <span className="font-bold text-good-fg">{diff}</span>;
  return <span className="font-bold text-bad-fg">{diff}</span>;
}

export function CommittedPanel({
  skus,
  actualBySku,
  month,
  setMonth,
  savingKey,
  updateCommitment,
}: {
  skus: SkuRow[];
  actualBySku: Map<string, number>;
  month: string;
  setMonth: (m: string) => void;
  savingKey: string | null;
  updateCommitment: (skuId: string, value: string) => void;
}) {
  const [accountFilter, setAccountFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Every account, regardless of whether it's started yet.
  const allAccounts = useMemo(() => {
    const map = new Map<string, { label: string; commitmentStart: string | null }>();
    skus.forEach((s) =>
      map.set(s.account_id, {
        label: s.accounts?.label ?? "—",
        commitmentStart: s.accounts?.commitment_start ?? null,
      })
    );
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, label: v.label, commitmentStart: v.commitmentStart }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [skus]);

  // Only accounts whose commencement date has arrived as of the selected
  // month — an account with no start date set is treated as always eligible.
  const accounts = useMemo(
    () => allAccounts.filter((a) => !a.commitmentStart || month >= a.commitmentStart.slice(0, 7)),
    [allAccounts, month]
  );

  const visibleAccounts = accountFilter ? accounts.filter((a) => a.id === accountFilter) : accounts;
  const hiddenByCommencement = allAccounts.length > 0 && accounts.length === 0;

  function toggle(accountId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  function accountSummary(accountId: string) {
    const accountSkus = skus.filter((s) => s.account_id === accountId);
    const achievements = accountSkus
      .filter((s) => s.commitment_per_month)
      .map((s) => (actualBySku.get(s.id) ?? 0) / (s.commitment_per_month as number));
    // Raw 0-1 ratio, not a percentage number — achievementBadge() does its
    // own *100 for display (and its color thresholds assume a 0-1 scale),
    // same as the per-row call below. Pre-multiplying here double-counted
    // the *100 and inflated every account header 100x (27% rendered "2700%").
    const avg = achievements.length
      ? achievements.reduce((a, b) => a + b, 0) / achievements.length
      : null;
    return { productCount: accountSkus.length, avg };
  }

  return (
    <div className="card">
      <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Actual vs committed</h3>
      <p className="mb-3.5 text-xs text-muted">
        Committed targets are editable and shared — change one here and everyone sees the update.
      </p>

      <div className="mb-3.5 flex flex-wrap gap-3">
        <div className="max-w-[200px]">
          <label className="field-label">Month</label>
          <input
            type="month"
            className="field-input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="max-w-[260px] flex-1">
          <label className="field-label">Filter by account</label>
          <select
            className="field-input"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {visibleAccounts.length === 0 ? (
        hiddenByCommencement ? (
          <Empty
            title="No accounts had started yet"
            body="None of the accounts had a commitment commencement date on or before this month."
          />
        ) : (
          <Empty title="No SKUs yet" body="Add SKUs for an account in the Accounts screen." />
        )
      ) : (
        <div className="space-y-2">
          {visibleAccounts.map((a) => {
            const isOpen = expanded.has(a.id) || accountFilter === a.id;
            const summary = accountSummary(a.id);
            const accountSkus = skus.filter((s) => s.account_id === a.id);
            return (
              <div key={a.id} className="overflow-hidden rounded-[4px] border border-border">
                <button
                  type="button"
                  onClick={() => toggle(a.id)}
                  className="flex w-full items-center justify-between bg-[#eef1f7] px-4 py-2.5 text-left hover:bg-[#e4e9f2]"
                >
                  <span className="text-[13px] font-bold text-ink-soft">{a.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-muted">{summary.productCount} products</span>
                    {achievementBadge(summary.avg)}
                    <span className="text-muted">{isOpen ? "−" : "+"}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="u-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Committed</th>
                          <th>Actual</th>
                          <th>Committed − Actual</th>
                          <th>Achievement</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accountSkus.map((s) => {
                          const actual = actualBySku.get(s.id) ?? 0;
                          const pct = s.commitment_per_month ? actual / s.commitment_per_month : null;
                          return (
                            <tr key={s.id}>
                              <td>{s.name}</td>
                              <td>
                                <input
                                  type="number"
                                  className="w-[72px] rounded-[4px] border border-border px-2 py-1.5 text-[12.5px] outline-none focus:border-accent"
                                  defaultValue={s.commitment_per_month ?? ""}
                                  placeholder="—"
                                  disabled={savingKey === s.id}
                                  onBlur={(e) => {
                                    if (e.target.value !== String(s.commitment_per_month ?? "")) {
                                      updateCommitment(s.id, e.target.value);
                                    }
                                  }}
                                />
                              </td>
                              <td>{actual}</td>
                              <td>{diffCell(s.commitment_per_month, actual)}</td>
                              <td>{achievementBadge(pct)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
