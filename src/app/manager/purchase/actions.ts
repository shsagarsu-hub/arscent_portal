"use server";

import { createClient } from "@/lib/supabase/server";
import { sendPurchaseOrderEmail } from "@/lib/email";
import { buildPurchaseOrderPdf } from "@/lib/pdf/purchaseOrderPdf";

export interface PurchaseLineInput {
  itemId: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  hsn: string;
}

export interface SubmitPurchaseInput {
  lines: PurchaseLineInput[];
  to: string[];
  cc: string[];
  replyTo: string;
  notes: string;
  gstPercent: number;
  delivery: string;
  payment: string;
  warranty: string;
}

/**
 * PO number is derived purely from the current time + a random suffix --
 * same reasoning as workOrderNo, but there's no backing row to derive it
 * from here (a purchase is just a batch of stock_movements rows sharing one
 * notes tag, not a dedicated table), so it has to be generated up front.
 */
function newPoNumber(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const suffix = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `PO-${yyyy}${mm}${dd}-${suffix}`;
}

/**
 * Writes one purchase_in stock_movements row per line (immediately
 * increasing warehouse inventory -- per the account manager's own workflow,
 * placing the PO with Zeiss is the moment stock is committed, not a later
 * goods-receipt step) then best-effort emails the PO to Zeiss. Same ordering
 * as createOrder/notifyOrderPlaced: the inventory effect is committed first
 * and never rolled back by an email failure, since the email is just a
 * notification of something that already happened in the ledger.
 */
export async function submitPurchaseOrder(input: SubmitPurchaseInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false as const, message: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "account_manager" && profile.role !== "admin")) {
    return { success: false as const, message: "Not authorized." };
  }
  if (input.lines.length === 0) return { success: false as const, message: "Add at least one product." };
  if (input.lines.some((l) => !l.itemId || l.qty <= 0 || l.unitPrice <= 0)) {
    return { success: false as const, message: "Every line needs a catalog item, a quantity, and a unit price greater than 0." };
  }
  if (input.to.length === 0) return { success: false as const, message: "Add at least one To recipient." };

  const poNumber = newPoNumber();
  const createdAt = new Date().toISOString();
  const noteTag = `Zeiss PO ${poNumber}${input.notes.trim() ? ` — ${input.notes.trim()}` : ""}`;

  const { error: insertError } = await supabase.from("stock_movements").insert(
    input.lines.map((l) => ({
      item_id: l.itemId,
      category: "purchase_in" as const,
      qty: l.qty,
      notes: noteTag,
    }))
  );
  if (insertError) return { success: false as const, message: insertError.message };

  let emailResult;
  try {
    const pdfBuffer = await buildPurchaseOrderPdf({
      poNumber,
      poDate: createdAt,
      lines: input.lines.map((l) => ({ itemName: l.itemName, hsn: l.hsn.trim() || null, qty: l.qty, unitPrice: l.unitPrice })),
      gstPercent: input.gstPercent,
      delivery: input.delivery,
      payment: input.payment,
      warranty: input.warranty,
    });
    emailResult = await sendPurchaseOrderEmail({
      poNumber,
      notes: input.notes.trim() || null,
      to: input.to,
      cc: input.cc,
      replyTo: input.replyTo || null,
      placedByName: profile.full_name ?? null,
      createdAt,
      pdf: { filename: `${poNumber}.pdf`, content: pdfBuffer },
    });
  } catch (err) {
    console.error("[submitPurchaseOrder] email failed:", err);
    emailResult = { sent: false as const, reason: err instanceof Error ? err.message : "unknown error" };
  }

  return { success: true as const, poNumber, email: emailResult };
}
