"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireManager() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();

  if (!profile || (profile.role !== "admin" && profile.role !== "account_manager")) {
    redirect("/");
  }
  return user.id;
}

export async function closeReceivable(
  invoiceNo: string,
  data: { amountReceived: string; utr: string; paymentDate: string }
) {
  const userId = await requireManager();
  const admin = createAdminClient();

  const amount = parseFloat(data.amountReceived);
  if (!data.amountReceived.trim() || isNaN(amount) || amount <= 0) {
    throw new Error("Enter a valid amount received.");
  }
  const utr = data.utr.trim();
  if (!utr) throw new Error("UTR is required.");
  if (!data.paymentDate) throw new Error("Payment date is required.");

  const { error } = await admin.from("receivable_payments").insert({
    invoice_no: invoiceNo,
    amount_received: amount,
    utr,
    payment_date: data.paymentDate,
    recorded_by: userId,
  });
  if (error) {
    // 23505 = unique violation on invoice_no -- someone already closed this
    // exact invoice (e.g. two tabs open), not a real conflict to surface as
    // a generic DB error.
    if (error.code === "23505") throw new Error("This invoice was already marked received.");
    throw new Error(error.message);
  }

  revalidatePath("/manager");
}

export async function reopenReceivable(invoiceNo: string) {
  await requireManager();
  const admin = createAdminClient();

  // Deletes every payment row for this invoice, not just one -- a partially
  // paid invoice (see allocatePaymentFifo) can carry more than one, and
  // "reopen" means fully unpaid again, not just undoing the most recent row.
  const { error } = await admin.from("receivable_payments").delete().eq("invoice_no", invoiceNo);
  if (error) throw new Error(error.message);

  revalidatePath("/manager");
}

export interface FifoAllocation {
  invoiceNo: string;
  invoiceDate: string;
  allocated: number;
  remainingDueAfter: number;
}

export interface FifoAllocationResult {
  allocations: FifoAllocation[];
  leftover: number;
}

/**
 * Applies one lump-sum receipt against an account's open invoices oldest
 * first, same order a real bank statement would clear them in. Each
 * touched invoice gets its own receivable_payments row (same UTR/date,
 * amount_received = however much of the lump sum landed on it) rather than
 * one big row against the first invoice -- necessary so a partially-paid
 * invoice still shows its own real remaining balance, and so undoing one
 * invoice (reopenReceivable) doesn't touch the others this same receipt
 * happened to also cover.
 *
 * Recomputed entirely server-side from tally_invoice_lines + existing
 * receivable_payments (not trusting client-supplied due amounts) since
 * this moves real money into the books.
 */
export async function allocatePaymentFifo(
  accountId: string,
  data: { totalAmount: string; utr: string; paymentDate: string }
): Promise<FifoAllocationResult> {
  const userId = await requireManager();
  const admin = createAdminClient();

  let remaining = parseFloat(data.totalAmount);
  if (!data.totalAmount.trim() || isNaN(remaining) || remaining <= 0) {
    throw new Error("Enter a valid amount received.");
  }
  const utr = data.utr.trim();
  if (!utr) throw new Error("UTR is required.");
  if (!data.paymentDate) throw new Error("Payment date is required.");

  const { data: lines, error: linesErr } = await admin
    .from("tally_invoice_lines")
    .select("invoice_no, invoice_date, document_type, related_invoice_no, qty, rate")
    .eq("account_id", accountId)
    .order("invoice_date");
  if (linesErr) throw new Error(linesErr.message);

  // Same invoice-total computation as ReceivablesPanel's own load() -- a
  // credit/debit note folds into the invoice it adjusts rather than
  // standing as its own line.
  const byInvoice = new Map<string, { invoiceDate: string; total: number }>();
  (lines ?? []).forEach((l) => {
    const key = l.document_type === "invoice" ? l.invoice_no : l.related_invoice_no;
    if (!key) return;
    const cur = byInvoice.get(key) ?? { invoiceDate: l.invoice_date, total: 0 };
    if (l.document_type === "invoice") cur.invoiceDate = l.invoice_date;
    cur.total += l.qty * (l.rate ?? 0);
    byInvoice.set(key, cur);
  });

  const invoiceNos = Array.from(byInvoice.keys());
  const { data: existingPayments, error: payErr } = await admin
    .from("receivable_payments")
    .select("invoice_no, amount_received")
    .in("invoice_no", invoiceNos);
  if (payErr) throw new Error(payErr.message);

  const receivedByInvoice = new Map<string, number>();
  (existingPayments ?? []).forEach((p) => {
    receivedByInvoice.set(p.invoice_no, (receivedByInvoice.get(p.invoice_no) ?? 0) + p.amount_received);
  });

  const open = Array.from(byInvoice.entries())
    .map(([invoiceNo, v]) => ({
      invoiceNo,
      invoiceDate: v.invoiceDate,
      remainingDue: v.total - (receivedByInvoice.get(invoiceNo) ?? 0),
    }))
    .filter((r) => r.remainingDue > 0.01)
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));

  const allocations: FifoAllocation[] = [];
  const rowsToInsert: { invoice_no: string; amount_received: number; utr: string; payment_date: string; recorded_by: string }[] = [];

  for (const r of open) {
    if (remaining <= 0.01) break;
    const allocated = Math.min(remaining, r.remainingDue);
    rowsToInsert.push({
      invoice_no: r.invoiceNo,
      amount_received: allocated,
      utr,
      payment_date: data.paymentDate,
      recorded_by: userId,
    });
    allocations.push({ invoiceNo: r.invoiceNo, invoiceDate: r.invoiceDate, allocated, remainingDueAfter: r.remainingDue - allocated });
    remaining -= allocated;
  }

  if (rowsToInsert.length > 0) {
    const { error: insertErr } = await admin.from("receivable_payments").insert(rowsToInsert);
    if (insertErr) throw new Error(insertErr.message);
  }

  revalidatePath("/manager");
  return { allocations, leftover: remaining };
}
