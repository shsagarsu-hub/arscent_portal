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
}

export async function saveCommitmentAdjustment(data: {
  accountId: string;
  skuId: string;
  periodMonth: string;
  actualQty: number;
  commitmentQty: number;
  adjustmentType: "credit" | "debit";
  adjustmentAmount: number;
}) {
  await requireManager();
  const admin = createAdminClient();

  const { error } = await admin.from("commitment_adjustments").insert({
    account_id: data.accountId,
    sku_id: data.skuId,
    period_month: data.periodMonth,
    actual_qty: data.actualQty,
    commitment_qty: data.commitmentQty,
    adjustment_type: data.adjustmentType,
    adjustment_amount: data.adjustmentAmount,
  });
  if (error) {
    if (error.code === "23505") throw new Error("This month has already been recorded.");
    throw new Error(error.message);
  }

  revalidatePath("/manager");
}

export async function markAdjustmentRaised(id: string, noteNo: string, raisedDate: string) {
  await requireManager();
  const admin = createAdminClient();

  if (!noteNo.trim()) throw new Error("Note number is required.");
  if (!raisedDate) throw new Error("Raised date is required.");

  const { error } = await admin
    .from("commitment_adjustments")
    .update({ status: "raised", note_no: noteNo.trim(), raised_date: raisedDate })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/manager");
}

export async function deleteCommitmentAdjustment(id: string) {
  await requireManager();
  const admin = createAdminClient();

  const { error } = await admin.from("commitment_adjustments").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/manager");
}
