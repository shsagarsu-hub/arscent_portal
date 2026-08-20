"use client";

import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "./AppShell";
import { saveCommitmentAdjustment, markAdjustmentRaised, deleteCommitmentAdjustment } from "@/app/manager/commitments/actions";
import type { CommitmentAdjustment } from "@/lib/supabase/database.types";

// Sourced directly from the signed LVPEI Recurring Consumables Agreement
// (Clauses 7 & 8, executed 13-Aug-2026) -- this mechanism applies ONLY to
// LVPEI's CT Lucia IOL commitment. Narayana Nethralaya has no equivalent
// clause in its agreement, and LVPEI's SMILE PRO commitment has no monthly
// penalty either (it's paid in advance, no shortfall mechanism defined).
// This is deliberately hardcoded to this one specific, legally-sourced
// formula rather than built as a generic configurable rule engine -- there
// is exactly one real clause to encode right now, and a speculative
// generic engine for hypothetical future clauses would be guessing at
// requirements nobody has stated.
const LVPEI_ACCOUNT_CODE = "LVPEI";
const CT_LUCIA_SKU_NAME = "CT LUCIA";
const MONTHLY_COMMITMENT = 250;
const CREDIT_RATE_BASE = 1500; // Clause 7.2 -- per unit, for the first 250 when commitment is met or exceeded
const CREDIT_RATE_ADDITIONAL = 2100; // Clause 7.3 -- per unit above 250
const DEBIT_RATE = 2100; // Clause 8.1 -- per unit shortfall below 250

interface AccountRow {
  id: string;
  code: string;
  commitment_start: string | null;
}

interface SkuRow {
  id: string;
  name: string;
  account_id: string;
}

interface InvoiceLineRow {
  sku_id: string | null;
  invoice_date: string;
  qty: number;
}

interface MonthRow {
  month: string; // "YYYY-MM"
  actualQty: number;
  type: "credit" | "debit";
  amount: number;
  existing: CommitmentAdjustment | null;
}

function inr(n: number) {
  return `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** Every month from commitment_start up to (not including) the current
 * in-progress month -- Clause 6.2 ties reconciliation to a completed
 * month's usage, so a still-running month can't be reconciled yet. */
function completedMonthsSince(startIso: string): string[] {
  const start = new Date(startIso + "T00:00:00Z");
  const now = new Date();
  const months: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const stop = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor.getTime() < stop.getTime()) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function computeAdjustment(actualQty: number): { type: "credit" | "debit"; amount: number } {
  if (actualQty < MONTHLY_COMMITMENT) {
    return { type: "debit", amount: (MONTHLY_COMMITMENT - actualQty) * DEBIT_RATE };
  }
  if (actualQty === MONTHLY_COMMITMENT) {
    return { type: "credit", amount: MONTHLY_COMMITMENT * CREDIT_RATE_BASE };
  }
  return {
    type: "credit",
    amount: MONTHLY_COMMITMENT * CREDIT_RATE_BASE + (actualQty - MONTHLY_COMMITMENT) * CREDIT_RATE_ADDITIONAL,
  };
}

function RaiseForm({ row, onDone }: { row: MonthRow; onDone: () => void }) {
  const [noteNo, setNoteNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!row.existing) return;
    setSaving(true);
    setError(null);
    try {
      await markAdjustmentRaised(row.existing.id, noteNo, date);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-[6px] border border-border bg-app/60 p-2.5">
      <div>
        <label className="field-label">{row.type === "debit" ? "Debit" : "Credit"} note number</label>
        <input className="field-input !py-1 w-[160px] text-[12.5px]" value={noteNo} onChange={(e) => setNoteNo(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Date raised</label>
        <input type="date" className="field-input !py-1 text-[12.5px]" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" disabled={saving} onClick={submit}>
        {saving ? "Saving…" : "Confirm raised"}
      </button>
      {error && <div className="w-full text-[11px] font-semibold text-bad-fg">{error}</div>}
    </div>
  );
}

export function CommitmentAdjustmentsPanel() {
  const supabase = createClient();
  const [rows, setRows] = useState<MonthRow[] | null>(null);
  const [ids, setIds] = useState<{ accountId: string; skuId: string } | null>(null);
  const [raisingMonth, setRaisingMonth] = useState<string | null>(null);
  const [savingMonth, setSavingMonth] = useState<string | null>(null);

  async function load() {
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, code, commitment_start")
      .eq("code", LVPEI_ACCOUNT_CODE)
      .returns<AccountRow[]>();
    const account = accounts?.[0];
    if (!account || !account.commitment_start) {
      setRows([]);
      return;
    }

    const { data: skus } = await supabase
      .from("skus")
      .select("id, name, account_id")
      .eq("account_id", account.id)
      .eq("name", CT_LUCIA_SKU_NAME)
      .returns<SkuRow[]>();
    const sku = skus?.[0];
    if (!sku) {
      setRows([]);
      return;
    }
    setIds({ accountId: account.id, skuId: sku.id });

    const months = completedMonthsSince(account.commitment_start);
    if (months.length === 0) {
      setRows([]);
      return;
    }
    const start = `${months[0]}-01`;
    const lastMonth = months[months.length - 1];
    const [ly, lm] = lastMonth.split("-").map(Number);
    const end = new Date(Date.UTC(ly, lm, 1)).toISOString().slice(0, 10);

    const [{ data: lines }, { data: existing }] = await Promise.all([
      supabase
        .from("tally_invoice_lines")
        .select("sku_id, invoice_date, qty")
        .eq("document_type", "invoice")
        .eq("account_id", account.id)
        .eq("sku_id", sku.id)
        .gte("invoice_date", start)
        .lt("invoice_date", end)
        .returns<InvoiceLineRow[]>(),
      supabase
        .from("commitment_adjustments")
        .select("*")
        .eq("account_id", account.id)
        .eq("sku_id", sku.id)
        .returns<CommitmentAdjustment[]>(),
    ]);

    const qtyByMonth = new Map<string, number>();
    (lines ?? []).forEach((l) => {
      const m = l.invoice_date.slice(0, 7);
      qtyByMonth.set(m, (qtyByMonth.get(m) ?? 0) + (l.qty || 0));
    });
    const existingByMonth = new Map((existing ?? []).map((e) => [e.period_month.slice(0, 7), e]));

    const result: MonthRow[] = months.map((month) => {
      const actualQty = qtyByMonth.get(month) ?? 0;
      const computed = computeAdjustment(actualQty);
      return { month, actualQty, ...computed, existing: existingByMonth.get(month) ?? null };
    });
    result.sort((a, b) => b.month.localeCompare(a.month));
    setRows(result);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (rows === null) return <Loading />;

  return (
    <div className="card">
      <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">LVPEI — CT Lucia commitment adjustment</h3>
      <p className="mb-3.5 text-xs text-muted">
        Per Clauses 7 &amp; 8 of the signed Recurring Consumables Agreement: below {MONTHLY_COMMITMENT}/month, a debit note at{" "}
        {inr(DEBIT_RATE)}/unit shortfall; at or above, a credit note at {inr(CREDIT_RATE_BASE)}/unit up to{" "}
        {MONTHLY_COMMITMENT} and {inr(CREDIT_RATE_ADDITIONAL)}/unit above. Recording here only tracks the amount and status
        — it doesn&apos;t issue anything in Tally.
      </p>

      {rows.length === 0 ? (
        <Empty title="Nothing to reconcile yet" body="LVPEI's commitment period hasn't reached a completed month yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="u-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Actual</th>
                <th className="text-right">Commitment</th>
                <th>Type</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = row.month;
                return (
                  <Fragment key={key}>
                    <tr>
                      <td className="whitespace-nowrap font-semibold text-ink">{monthLabel(row.month)}</td>
                      <td className="text-right">{row.actualQty}</td>
                      <td className="text-right">{MONTHLY_COMMITMENT}</td>
                      <td>
                        <span className={`badge ${row.type === "debit" ? "badge-bad" : "badge-good"}`}>
                          {row.type === "debit" ? "Debit note" : "Credit note"}
                        </span>
                      </td>
                      <td className={`text-right font-semibold ${row.type === "debit" ? "text-bad-fg" : "text-good-fg"}`}>
                        {inr(row.amount)}
                      </td>
                      <td>
                        {!row.existing ? (
                          <span className="badge badge-neutral">Not recorded</span>
                        ) : row.existing.status === "raised" ? (
                          <span className="badge badge-good">
                            Raised {row.existing.note_no ? `(${row.existing.note_no})` : ""}
                          </span>
                        ) : (
                          <span className="badge badge-watch">Pending</span>
                        )}
                      </td>
                      <td>
                        {!row.existing ? (
                          <button
                            type="button"
                            className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
                            disabled={savingMonth === row.month || !ids}
                            onClick={async () => {
                              if (!ids) return;
                              setSavingMonth(row.month);
                              await saveCommitmentAdjustment({
                                accountId: ids.accountId,
                                skuId: ids.skuId,
                                periodMonth: `${row.month}-01`,
                                actualQty: row.actualQty,
                                commitmentQty: MONTHLY_COMMITMENT,
                                adjustmentType: row.type,
                                adjustmentAmount: row.amount,
                              });
                              setSavingMonth(null);
                              void load();
                            }}
                          >
                            {savingMonth === row.month ? "Saving…" : "Record"}
                          </button>
                        ) : row.existing.status === "pending" ? (
                          <button
                            type="button"
                            className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
                            onClick={() => setRaisingMonth(raisingMonth === row.month ? null : row.month)}
                          >
                            {raisingMonth === row.month ? "Cancel" : "Mark raised"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
                            onClick={async () => {
                              if (!confirm(`Delete this record for ${monthLabel(row.month)}?`)) return;
                              await deleteCommitmentAdjustment(row.existing!.id);
                              void load();
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                    {raisingMonth === row.month && row.existing && (
                      <tr>
                        <td colSpan={7}>
                          <RaiseForm
                            row={row}
                            onDone={() => {
                              setRaisingMonth(null);
                              void load();
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
