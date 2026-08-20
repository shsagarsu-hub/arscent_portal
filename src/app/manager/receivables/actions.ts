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

  const { error } = await admin.from("receivable_payments").delete().eq("invoice_no", invoiceNo);
  if (error) throw new Error(error.message);

  revalidatePath("/manager");
}
