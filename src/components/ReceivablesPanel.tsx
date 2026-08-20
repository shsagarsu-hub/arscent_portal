"use client";

import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "./AppShell";
import { closeReceivable, reopenReceivable } from "@/app/manager/receivables/actions";

interface InvoiceLineRow {
  invoice_no: string;
  account_id: string;
  invoice_date: string;
  document_type: "invoice" | "credit_note" | "debit_note";
  related_invoice_no: string | null;
  qty: number;
  rate: number | null;
}

interface AccountRow {
  id: string;
  label: string;
  iol_payment_days: number | null;
}

interface PaymentRow {
  invoice_no: string;
  amount_received: number;
  utr: string;
  payment_date: string;
}

interface Receivable {
  invoiceNo: string;
  accountId: string;
  accountLabel: string;
  invoiceDate: string;
  total: number;
  dueDate: string | null;
  daysDue: number;
  payment: PaymentRow | null;
}

function inr(n: number) {
  const sign = n < 0 ? "−" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Every helper here stays anchored in UTC throughout -- parse as UTC
// midnight, manipulate with the UTC variants, read back via toISOString()
// (always UTC). Mixing in any local-time step (e.g. plain getDate/setDate)
// and then reading back with toISOString() silently shifts the result by a
// day for any timezone ahead of UTC: local midnight in IST (UTC+5:30)
// serializes to 18:30 the PREVIOUS day in UTC. Confirmed live -- due dates
// were coming out a day early for exactly this reason.
function addDays(dateIso: string, days: number) {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string) {
  const from = new Date(fromIso + "T00:00:00Z").getTime();
  const to = new Date(toIso + "T00:00:00Z").getTime();
  return Math.round((to - from) / 86400000);
}

// "Today" means the account manager's own local calendar day, not UTC's --
// read directly off the local Date fields rather than going through
// toISOString(), which would introduce the same UTC-shift bug for the one
// user-facing date that's genuinely about "now" rather than pure date math.
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function CloseReceivableForm({ invoiceNo, onDone }: { invoiceNo: string; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await closeReceivable(invoiceNo, { amountReceived: amount, utr, paymentDate: date });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-[6px] border border-border bg-app/60 p-2.5">
      <div>
        <label className="field-label">Amount received</label>
        <input
          type="number"
          step="0.01"
          className="field-input !py-1 w-[130px] text-[12.5px]"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label">UTR</label>
        <input className="field-input !py-1 w-[150px] text-[12.5px]" value={utr} onChange={(e) => setUtr(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Date received</label>
        <input
          type="date"
          className="field-input !py-1 text-[12.5px]"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" disabled={saving} onClick={submit}>
        {saving ? "Saving…" : "Mark received"}
      </button>
      {error && <div className="w-full text-[11px] font-semibold text-bad-fg">{error}</div>}
    </div>
  );
}

/**
 * "Due" comes from confirmed Tally invoices, not usage or committed
 * targets -- this is real accounts-receivable tracking, one line per real
 * invoice_no. Credit/debit notes fold into the invoice they adjust
 * (related_invoice_no) rather than appearing as their own receivable line,
 * since they're a correction to what's owed, not a separate bill. Due date
 * comes straight from each account's own iol_payment_days (set in
 * Accounts) -- that's the payment term "as per agreement" the account
 * manager already keeps up to date, not a number this duplicates.
 */
export function ReceivablesPanel() {
  const supabase = createClient();
  const [receivables, setReceivables] = useState<Receivable[] | null>(null);
  const [closingInvoice, setClosingInvoice] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState("");
  const [showReceived, setShowReceived] = useState(false);
  const [reopeningInvoice, setReopeningInvoice] = useState<string | null>(null);

  async function load() {
    const [{ data: lines }, { data: accountRows }, { data: payments }] = await Promise.all([
      supabase
        .from("tally_invoice_lines")
        .select("invoice_no, account_id, invoice_date, document_type, related_invoice_no, qty, rate")
        .order("invoice_date")
        .returns<InvoiceLineRow[]>(),
      supabase.from("accounts").select("id, label, iol_payment_days").returns<AccountRow[]>(),
      supabase.from("receivable_payments").select("invoice_no, amount_received, utr, payment_date").returns<PaymentRow[]>(),
    ]);

    const accountMap = new Map((accountRows ?? []).map((a) => [a.id, a]));
    const paymentMap = new Map((payments ?? []).map((p) => [p.invoice_no, p]));
    const today = todayIso();

    const byInvoice = new Map<string, { accountId: string; invoiceDate: string; total: number }>();
    (lines ?? []).forEach((l) => {
      const key = l.document_type === "invoice" ? l.invoice_no : l.related_invoice_no;
      if (!key) return;
      const cur = byInvoice.get(key) ?? { accountId: l.account_id, invoiceDate: l.invoice_date, total: 0 };
      if (l.document_type === "invoice") {
        cur.accountId = l.account_id;
        cur.invoiceDate = l.invoice_date;
      }
      cur.total += l.qty * (l.rate ?? 0);
      byInvoice.set(key, cur);
    });

    const result: Receivable[] = Array.from(byInvoice.entries()).map(([invoiceNo, v]) => {
      const account = accountMap.get(v.accountId);
      const dueDate = account?.iol_payment_days != null ? addDays(v.invoiceDate, account.iol_payment_days) : null;
      return {
        invoiceNo,
        accountId: v.accountId,
        accountLabel: account?.label ?? "—",
        invoiceDate: v.invoiceDate,
        total: v.total,
        dueDate,
        daysDue: daysBetween(v.invoiceDate, today),
        payment: paymentMap.get(invoiceNo) ?? null,
      };
    });
    result.sort((a, b) => b.daysDue - a.daysDue);
    setReceivables(result);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (receivables === null) return <Loading />;

  const accounts = Array.from(new Map(receivables.map((r) => [r.accountId, r.accountLabel])).entries()).sort((a, b) =>
    a[1].localeCompare(b[1])
  );

  const filtered = receivables.filter((r) => !accountFilter || r.accountId === accountFilter);
  const due = filtered.filter((r) => !r.payment);
  const received = filtered.filter((r) => r.payment);

  const totalDue = due.reduce((a, r) => a + r.total, 0);
  const overdue = due.filter((r) => r.dueDate && r.dueDate < todayIso());
  const totalOverdue = overdue.reduce((a, r) => a + r.total, 0);

  return (
    <div className="card">
      <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">Receivables</h3>
      <p className="mb-3.5 text-xs text-muted">
        Every confirmed Tally invoice, due as per each account&apos;s payment term (set in Accounts). A due line closes only
        by recording the amount received, UTR, and payment date.
      </p>

      <div className="mb-3.5 flex flex-wrap items-end gap-3">
        <div className="max-w-[260px] flex-1">
          <label className="field-label">Client</label>
          <select className="field-input" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-[6px] border border-border bg-card p-3">
          <div className="text-[17px] font-extrabold text-ink">{inr(totalDue)}</div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted">Total due</div>
        </div>
        <div className="rounded-[6px] border border-border bg-card p-3">
          <div className={`text-[17px] font-extrabold ${totalOverdue > 0 ? "text-bad-fg" : "text-ink"}`}>{inr(totalOverdue)}</div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted">Overdue ({overdue.length})</div>
        </div>
        <div className="rounded-[6px] border border-border bg-card p-3">
          <div className="text-[17px] font-extrabold text-ink">{due.length}</div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted">Invoices due</div>
        </div>
      </div>

      {due.length === 0 ? (
        <Empty title="Nothing due" body="Every confirmed invoice has been marked received." />
      ) : (
        <div className="overflow-x-auto">
          <table className="u-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Account</th>
                <th>Invoice date</th>
                <th>Due date</th>
                <th className="text-right">Days due</th>
                <th className="text-right">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {due.map((r) => {
                const isOverdue = !!r.dueDate && r.dueDate < todayIso();
                return (
                  <Fragment key={r.invoiceNo}>
                    <tr>
                      <td className="whitespace-nowrap font-semibold text-ink">{r.invoiceNo}</td>
                      <td className="text-muted">{r.accountLabel}</td>
                      <td className="text-muted">{r.invoiceDate}</td>
                      <td className={isOverdue ? "font-bold text-bad-fg" : "text-muted"}>{r.dueDate ?? "—"}</td>
                      <td className={`text-right ${isOverdue ? "font-bold text-bad-fg" : ""}`}>{r.daysDue}d</td>
                      <td className="text-right font-semibold text-ink">{inr(r.total)}</td>
                      <td>
                        <button
                          type="button"
                          className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
                          onClick={() => setClosingInvoice(closingInvoice === r.invoiceNo ? null : r.invoiceNo)}
                        >
                          {closingInvoice === r.invoiceNo ? "Cancel" : "Mark received"}
                        </button>
                      </td>
                    </tr>
                    {closingInvoice === r.invoiceNo && (
                      <tr>
                        <td colSpan={7}>
                          <CloseReceivableForm
                            invoiceNo={r.invoiceNo}
                            onDone={() => {
                              setClosingInvoice(null);
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

      <button type="button" className="mt-4 text-xs font-bold text-accent" onClick={() => setShowReceived((v) => !v)}>
        {showReceived ? "Hide" : "Show"} received ({received.length})
      </button>

      {showReceived && received.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="u-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Account</th>
                <th className="text-right">Amount received</th>
                <th>UTR</th>
                <th>Date received</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {received.map((r) => (
                <tr key={r.invoiceNo}>
                  <td className="whitespace-nowrap font-semibold text-ink">{r.invoiceNo}</td>
                  <td className="text-muted">{r.accountLabel}</td>
                  <td className="text-right text-good-fg">{inr(r.payment!.amount_received)}</td>
                  <td className="font-mono text-[11.5px] text-muted">{r.payment!.utr}</td>
                  <td className="text-muted">{r.payment!.payment_date}</td>
                  <td>
                    <button
                      type="button"
                      className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
                      disabled={reopeningInvoice === r.invoiceNo}
                      onClick={async () => {
                        if (!confirm(`Reopen ${r.invoiceNo}? This removes the recorded payment.`)) return;
                        setReopeningInvoice(r.invoiceNo);
                        await reopenReceivable(r.invoiceNo);
                        setReopeningInvoice(null);
                        void load();
                      }}
                    >
                      {reopeningInvoice === r.invoiceNo ? "Reopening…" : "Reopen"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
