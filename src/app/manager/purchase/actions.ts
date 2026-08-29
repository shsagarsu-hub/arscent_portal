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
  poNumber?: string;
}

/**
 * Falls back to a generated number only when the account manager leaves the
 * PO Number field blank -- Arscent's real numbering (e.g.
 * "AR/IOLs/26-27/17") is sequential and financial-year-scoped, which this
 * can't replicate without a backing table, so typing the real one in is the
 * normal path and this is just a safety net so the field is never required.
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
 * Records the PO in purchase_orders/purchase_order_lines (its own real
 * table, not stock_movements) then best-effort emails the PO to Zeiss.
 * Deliberately does NOT touch stock -- raising a PO is a commitment to buy,
 * not a goods receipt. Warehouse stock only ever moves for an actual
 * receipt (Purchase Invoice import or manual Log Movement) or a sale; an
 * earlier version of this action wrote a purchase_in row here directly,
 * which credited stock before the goods had arrived and had to be
 * corrected (see purchase_orders.sql).
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

  const poNumber = input.poNumber?.trim() || newPoNumber();
  const createdAt = new Date().toISOString();

  const { data: po, error: poError } = await supabase
    .from("purchase_orders")
    .insert({
      po_number: poNumber,
      created_by: user.id,
      created_at: createdAt,
      gst_percent: input.gstPercent,
      delivery: input.delivery || null,
      payment: input.payment || null,
      warranty: input.warranty || null,
      notes: input.notes.trim() || null,
      to_emails: input.to.join(", "),
      cc_emails: input.cc.join(", "),
    })
    .select("id")
    .single();
  if (poError || !po) return { success: false as const, message: poError?.message ?? "Couldn't record the PO." };

  const { error: insertError } = await supabase.from("purchase_order_lines").insert(
    input.lines.map((l) => ({
      purchase_order_id: po.id,
      item_id: l.itemId,
      item_name: l.itemName,
      qty: l.qty,
      unit_price: l.unitPrice,
      hsn: l.hsn.trim() || null,
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
