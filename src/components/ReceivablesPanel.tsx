"use client";

import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Empty, Loading } from "./AppShell";
import {
  closeReceivable,
  reopenReceivable,
  allocatePaymentFifo,
  deleteAllocation,
  type FifoAllocationResult,
} from "@/app/manager/receivables/actions";
import { ExportButton } from "./ExportButton";

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
  payments: PaymentRow[];
  totalReceived: number;
  remainingDue: number;
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

// Common TDS rates a hospital might deduct before remitting -- not a
// statement of which section applies to Arscent specifically, just quick
// presets so the account manager isn't typing a rate from memory each time.
// "Custom" reveals a free-entry field for anything else.
const TDS_PRESETS: { label: string; value: string }[] = [
  { label: "No TDS (0%)", value: "0" },
  { label: "0.1% — Sec 194Q (goods)", value: "0.1" },
  { label: "1% — Sec 194C (individual/HUF)", value: "1" },
  { label: "2% — Sec 194C (company) / 194-I", value: "2" },
  { label: "5%", value: "5" },
  { label: "10% — Sec 194J (professional fees)", value: "10" },
  { label: "Custom…", value: "custom" },
];

function CloseReceivableForm({
  invoiceNo,
  defaultAmount,
  onDone,
}: {
  invoiceNo: string;
  defaultAmount: number;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(defaultAmount));
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
 * One lump-sum receipt, applied server-side (allocatePaymentFifo) against
 * an account's open invoices oldest-first -- the common real case where a
 * client pays a round number that doesn't line up with any single invoice.
 * Shown collapsed by default since most days nobody needs it; the per-
 * invoice "Mark received" flow above stays the default path.
 */
function FifoPaymentForm({
  accounts,
  defaultAccountId,
  onDone,
}: {
  accounts: [string, string][];
  defaultAccountId: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [date, setDate] = useState(todayIso());
  const [tdsPreset, setTdsPreset] = useState("0");
  const [tdsCustom, setTdsCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FifoAllocationResult | null>(null);
  const [deleting, setDeleting] = useState(false);

  const tdsRate = tdsPreset === "custom" ? tdsCustom : tdsPreset;

  async function submit() {
    if (!accountId) {
      setError("Pick which account this payment is from.");
      return;
    }
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const res = await allocatePaymentFifo(accountId, { totalAmount: amount, utr, paymentDate: date, tdsRate });
      setResult(res);
      setAmount("");
      setUtr("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment.");
    } finally {
      setSaving(false);
    }
  }

  async function undo() {
    if (!result) return;
    if (!confirm(`Delete this allocation? This removes the payment recorded against all ${result.allocations.length} invoice(s) it touched.`)) return;
    setDeleting(true);
    try {
      await deleteAllocation(result.utr, result.paymentDate);
      setResult(null);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete allocation.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mb-4 rounded-[6px] border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[12.5px] font-bold text-ink-soft">Record a lump-sum payment (auto-allocate FIFO)</span>
        <span className="text-muted">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-border p-3">
          <p className="mb-2.5 text-[11px] text-muted">
            Applies the amount against this account&apos;s open invoices, oldest first, closing what it fully covers and
            leaving a partial balance on whichever invoice it runs out on.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="field-label">Account</label>
              <select
                className="field-input !py-1 w-[220px] text-[12.5px]"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Select…</option>
                {accounts.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Amount received (cash, bank credit)</label>
              <input
                type="number"
                step="0.01"
                className="field-input !py-1 w-[150px] text-[12.5px]"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">TDS deducted</label>
              <select
                className="field-input !py-1 w-[190px] text-[12.5px]"
                value={tdsPreset}
                onChange={(e) => setTdsPreset(e.target.value)}
              >
                {TDS_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            {tdsPreset === "custom" && (
              <div>
                <label className="field-label">Rate (%)</label>
                <input
                  type="number"
                  step="0.01"
                  className="field-input !py-1 w-[90px] text-[12.5px]"
                  value={tdsCustom}
                  onChange={(e) => setTdsCustom(e.target.value)}
                />
              </div>
            )}
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
              {saving ? "Allocating…" : "Allocate"}
            </button>
          </div>
          {parseFloat(tdsRate || "0") > 0 && (
            <p className="mt-1.5 text-[11px] text-muted">
              Invoices will be cleared against the grossed-up value (cash + TDS) so the TDS-withheld portion doesn&apos;t
              stay stuck in &quot;due&quot; forever.
            </p>
          )}
          {error && <div className="mt-2 text-[11px] font-semibold text-bad-fg">{error}</div>}
          {result && (
            <div className="mt-3 rounded-[6px] border border-border bg-app/60 p-2.5">
              {result.allocations.length === 0 ? (
                <p className="text-[11.5px] text-muted">No open invoices to apply this against.</p>
              ) : (
                <>
                  <table className="u-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Invoice date</th>
                        <th className="text-right">Allocated (gross)</th>
                        <th className="text-right">Remaining after</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.allocations.map((a) => (
                        <tr key={a.invoiceNo}>
                          <td className="whitespace-nowrap font-semibold text-ink">{a.invoiceNo}</td>
                          <td className="text-muted">{a.invoiceDate}</td>
                          <td className="text-right text-good-fg">{inr(a.allocated)}</td>
                          <td className="text-right text-muted">{a.remainingDueAfter > 0 ? inr(a.remainingDueAfter) : "closed"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.tdsApplied > 0.01 && (
                    <p className="mt-2 text-[11.5px] text-muted">
                      Of {inr(result.grossApplied)} cleared, {inr(result.tdsApplied)} was TDS (not cash).
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn-outline-danger mt-2 !px-2.5 !py-1 text-[11px]"
                    disabled={deleting}
                    onClick={undo}
                  >
                    {deleting ? "Deleting…" : "Delete this allocation"}
                  </button>
                </>
              )}
              {result.leftover > 0.01 && (
                <p className="mt-2 text-[11.5px] font-semibold text-watch-fg">
                  {inr(result.leftover)} left over — no more open invoices to apply it against. Hold it for the next
                  invoice, or double-check the amount.
                </p>
              )}
            </div>
          )}
        </div>
      )}
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
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);

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
    const paymentsByInvoice = new Map<string, PaymentRow[]>();
    (payments ?? []).forEach((p) => {
      const arr = paymentsByInvoice.get(p.invoice_no) ?? [];
      arr.push(p);
      paymentsByInvoice.set(p.invoice_no, arr);
    });
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
      const invoicePayments = paymentsByInvoice.get(invoiceNo) ?? [];
      const totalReceived = invoicePayments.reduce((a, p) => a + p.amount_received, 0);
      return {
        invoiceNo,
        accountId: v.accountId,
        accountLabel: account?.label ?? "—",
        invoiceDate: v.invoiceDate,
        total: v.total,
        dueDate,
        daysDue: daysBetween(v.invoiceDate, today),
        payments: invoicePayments,
        totalReceived,
        // Floating-point sums can land a hair off zero (e.g. 0.0000000002)
        // -- clamped so a fully-paid invoice doesn't linger in "due" for a
        // fraction of a rupee.
        remainingDue: Math.max(0, Math.round((v.total - totalReceived) * 100) / 100),
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
  // A partially-paid invoice belongs in both: it still owes a remaining
  // balance (due) and it has real payment rows to show (received).
  const due = filtered.filter((r) => r.remainingDue > 0.01);
  const received = filtered.filter((r) => r.payments.length > 0);

  const totalDue = due.reduce((a, r) => a + r.remainingDue, 0);
  const overdue = due.filter((r) => r.dueDate && r.dueDate < todayIso());
  const totalOverdue = overdue.reduce((a, r) => a + r.remainingDue, 0);

  return (
    <div className="card">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[14.5px] font-extrabold text-ink">Receivables</h3>
        <ExportButton
          filename="receivables-due"
          columns={[
            { key: "invoiceNo", label: "Invoice" },
            { key: "accountLabel", label: "Account" },
            { key: "invoiceDate", label: "Invoice date" },
            { key: "dueDate", label: "Due date" },
            { key: "daysDue", label: "Days due" },
            { key: "total", label: "Invoice total" },
            { key: "totalReceived", label: "Received so far" },
            { key: "remainingDue", label: "Remaining due" },
          ]}
          rows={due}
        />
      </div>
      <p className="mb-3.5 text-xs text-muted">
        Every confirmed Tally invoice, due as per each account&apos;s payment term (set in Accounts). Close one invoice at a
        time below, or record a lump-sum receipt and let it apply itself across the oldest open invoices first.
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

      <FifoPaymentForm accounts={accounts} defaultAccountId={accountFilter} onDone={() => void load()} />

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
                      <td className="text-right font-semibold text-ink">
                        {inr(r.remainingDue)}
                        {r.totalReceived > 0 && (
                          <div className="text-[10px] font-normal text-muted">of {inr(r.total)} — partially paid</div>
                        )}
                      </td>
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
                            defaultAmount={r.remainingDue}
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
              {/* One row per payment, not per invoice -- a partially-paid
                  invoice (see allocatePaymentFifo) can carry more than one.
                  Rows sharing (utr, payment_date) came from one lump-sum
                  allocation call -- grouped so it can be undone as a whole
                  instead of one invoice at a time. */}
              {(() => {
                const rows = received
                  .flatMap((r) => r.payments.map((p) => ({ r, p })))
                  .sort((a, b) => `${a.p.utr}__${a.p.payment_date}`.localeCompare(`${b.p.utr}__${b.p.payment_date}`) || a.r.invoiceNo.localeCompare(b.r.invoiceNo));
                const batchKey = (p: PaymentRow) => `${p.utr}__${p.payment_date}`;
                const batchSizes = new Map<string, number>();
                rows.forEach(({ p }) => batchSizes.set(batchKey(p), (batchSizes.get(batchKey(p)) ?? 0) + 1));

                return rows.map(({ r, p }, i) => {
                  const key = batchKey(p);
                  const batchSize = batchSizes.get(key) ?? 1;
                  const isBatch = batchSize > 1;
                  return (
                    <tr key={`${r.invoiceNo}-${i}`}>
                      <td className="whitespace-nowrap font-semibold text-ink">{r.invoiceNo}</td>
                      <td className="text-muted">{r.accountLabel}</td>
                      <td className="text-right text-good-fg">{inr(p.amount_received)}</td>
                      <td className="font-mono text-[11.5px] text-muted">{p.utr}</td>
                      <td className="text-muted">{p.payment_date}</td>
                      <td>
                        {isBatch ? (
                          <button
                            type="button"
                            className="btn-outline-danger !px-2.5 !py-1 text-[11px]"
                            disabled={deletingBatch === key}
                            onClick={async () => {
                              if (
                                !confirm(
                                  `Delete this allocation? This removes the payment recorded against all ${batchSize} invoices it covered (UTR ${p.utr}, ${p.payment_date}).`
                                )
                              )
                                return;
                              setDeletingBatch(key);
                              await deleteAllocation(p.utr, p.payment_date);
                              setDeletingBatch(null);
                              void load();
                            }}
                          >
                            {deletingBatch === key ? "Deleting…" : `Delete allocation (${batchSize})`}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="rounded-[4px] border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-ink-soft"
                            disabled={reopeningInvoice === r.invoiceNo}
                            onClick={async () => {
                              if (!confirm(`Reopen ${r.invoiceNo}? This removes all recorded payments for this invoice.`)) return;
                              setReopeningInvoice(r.invoiceNo);
                              await reopenReceivable(r.invoiceNo);
                              setReopeningInvoice(null);
                              void load();
                            }}
                          >
                            {reopeningInvoice === r.invoiceNo ? "Reopening…" : "Reopen"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
