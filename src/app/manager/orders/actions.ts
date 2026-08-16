"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrderNotification } from "@/lib/email";
import { workOrderNo } from "@/lib/orders/workOrderNo";
import { ORDER_TYPE_LABELS } from "@/lib/orders/orderTypeLabels";
import type { OrderType } from "@/lib/supabase/database.types";

export interface OrderLineInput {
  skuId: string;
  qty: number;
  uom: string;
  netPrice: number | null;
  notes?: string | null;
}

export interface CreateOrderInput {
  orderType: OrderType;
  accountId: string;
  locationId: string;
  poNumber: string;
  requestedDate: string;
  deliveryInstruction: string;
  comment: string;
  taxCode: string;
  orderLineText: string;
  currencyCode: string;
  salesRep: string;
  partialShipment: boolean;
  poAttachmentUrl?: string | null;
  lines: OrderLineInput[];
}

export async function createOrder(input: CreateOrderInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false as const, message: "Not signed in." };

  if (!input.locationId) return { success: false as const, message: "Select Ship To first." };
  if (input.lines.length === 0) return { success: false as const, message: "Add at least one product." };

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      order_type: input.orderType,
      account_id: input.accountId,
      location_id: input.locationId,
      po_number: input.poNumber || null,
      requested_date: input.requestedDate || null,
      delivery_instruction: input.deliveryInstruction || null,
      comment: input.comment || null,
      tax_code: input.taxCode || null,
      order_line_text: input.orderLineText || null,
      currency_code: input.currencyCode || "INR",
      sales_rep: input.salesRep || null,
      partial_shipment: input.partialShipment,
      po_attachment_url: input.poAttachmentUrl || null,
      created_by: user.id,
    })
    .select("id, created_at")
    .single();

  if (orderError || !order) {
    return {
      success: false as const,
      message: orderError?.message ?? "Could not create order — check you're signed in as an account manager or admin.",
    };
  }

  const { error: linesError } = await supabase.from("order_lines").insert(
    input.lines.map((l) => ({
      order_id: order.id,
      sku_id: l.skuId,
      qty: l.qty,
      uom: l.uom,
      net_price: l.netPrice,
      notes: l.notes || null,
    }))
  );

  if (linesError) {
    return { success: false as const, message: linesError.message };
  }

  revalidatePath("/manager/orders/enquiry");

  const workOrderNumber = workOrderNo(order.id, order.created_at);
  const emailResult = await notifyOrderPlaced({
    orderId: order.id,
    createdAt: order.created_at,
    orderType: input.orderType,
    accountId: input.accountId,
    locationId: input.locationId,
    poNumber: input.poNumber,
    requestedDate: input.requestedDate,
    comment: input.comment,
    createdBy: user.id,
    lines: input.lines,
  });

  return {
    success: true as const,
    orderId: order.id as string,
    workOrderNo: workOrderNumber,
    email: emailResult,
  };
}

/**
 * Best-effort order notification -- uses the admin client purely for the
 * auth.users email lookups (account_id/location_id/sku names are already
 * readable under the caller's own RLS, but auth.users isn't exposed to
 * regular clients at all). A failure here never fails the order itself;
 * the order is already committed by the time this runs.
 */
async function notifyOrderPlaced(input: {
  orderId: string;
  createdAt: string;
  orderType: OrderType;
  accountId: string;
  locationId: string;
  poNumber: string;
  requestedDate: string;
  comment: string;
  createdBy: string;
  lines: OrderLineInput[];
}) {
  try {
    const admin = createAdminClient();

    const [{ data: account }, { data: location }, { data: skuRows }, { data: submitterProfile }, { data: userList }, { data: managerProfiles }] =
      await Promise.all([
        admin.from("accounts").select("label").eq("id", input.accountId).single(),
        admin.from("account_locations").select("name").eq("id", input.locationId).single(),
        admin.from("skus").select("id, name").in("id", input.lines.map((l) => l.skuId)),
        admin.from("profiles").select("full_name").eq("id", input.createdBy).maybeSingle(),
        admin.auth.admin.listUsers(),
        admin.from("profiles").select("id").in("role", ["account_manager", "admin"]),
      ]);

    const emailById = new Map(userList?.users.map((u) => [u.id, u.email]) ?? []);
    const skuNameById = new Map((skuRows ?? []).map((s) => [s.id, s.name]));
    const managerEmails = (managerProfiles ?? [])
      .map((p) => emailById.get(p.id))
      .filter((e): e is string => !!e);

    return await sendOrderNotification({
      workOrderNo: workOrderNo(input.orderId, input.createdAt),
      orderTypeLabel: ORDER_TYPE_LABELS[input.orderType],
      accountLabel: account?.label ?? "—",
      locationName: location?.name ?? "—",
      poNumber: input.poNumber || null,
      requestedDate: input.requestedDate || null,
      comment: input.comment || null,
      createdAt: input.createdAt,
      lines: input.lines.map((l) => ({
        skuName: skuNameById.get(l.skuId) ?? "—",
        spec: l.notes ?? null,
        qty: l.qty,
        netPrice: l.netPrice,
      })),
      hospitalEmail: emailById.get(input.createdBy) ?? null,
      hospitalName: submitterProfile?.full_name ?? null,
      managerEmails,
    });
  } catch (err) {
    console.error("[notifyOrderPlaced] failed:", err);
    return { sent: false as const, reason: err instanceof Error ? err.message : "unknown error" };
  }
}

async function requireManagerSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase: null as never, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "account_manager" && profile.role !== "admin")) {
    return { supabase: null as never, error: "Not authorized." };
  }
  return { supabase, error: null as null };
}

/**
 * Manager confirms a consumption order (created from Log Usage against a PO)
 * is going into the consignment billing pipeline -- one billing_requests row
 * per order line, same pending state every usage-log-sourced row starts in.
 * From here it's the exact same Record -> Pending Invoice -> billed flow
 * (see ConsignmentBillingPanel); the only difference is there's no usage_log
 * row behind it, so the manager confirms the exact catalog item + batch at
 * Record time instead of a hospital having picked them at Log Usage time.
 *
 * This is deliberately NOT the original LTC/STC placement order -- that one
 * closes on its own via a DC number (see OrderFulfillmentModal), which moves
 * stock from the warehouse into the hospital's consignment balance but isn't
 * a billing event. This function only ever runs against the *consumption*
 * order created afterward, once some of that consignment stock is used.
 *
 * billing_requests has no direct INSERT policy for anyone except its own
 * SECURITY DEFINER trigger (see billing_requests_invoice.sql) -- this goes
 * through the service-role client rather than opening a second RLS write
 * path onto a table that's deliberately locked down.
 */
export async function sendOrderToConsignment(orderId: string) {
  const { supabase, error: authError } = await requireManagerSession();
  if (authError) return { success: false as const, message: authError };

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, account_id, location_id, order_type, order_lines(id, sku_id, qty, net_price)")
    .eq("id", orderId)
    .single();
  if (orderErr || !order) return { success: false as const, message: orderErr?.message ?? "Order not found." };
  if (order.order_type !== "long_term_consignment_consumption" && order.order_type !== "short_term_consignment_consumption") {
    return { success: false as const, message: "Only a consumption order (created from Log Usage against a PO) can be sent to Consignment." };
  }
  if (order.order_lines.length === 0) {
    return { success: false as const, message: "This order has no line items." };
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error: insertErr } = await admin.from("billing_requests").insert(
    order.order_lines.map((l) => ({
      order_line_id: l.id,
      account_id: order.account_id,
      location_id: order.location_id,
      sku_id: l.sku_id,
      entry_date: today,
      qty: l.qty,
      unit_price: l.net_price,
      amount: l.net_price != null ? l.net_price * l.qty : null,
    }))
  );
  if (insertErr) return { success: false as const, message: insertErr.message };

  revalidatePath("/manager");
  return { success: true as const };
}

export interface ConsignmentBalanceLine {
  skuId: string;
  skuName: string;
  consignmentQty: number;
  netPrice: number | null;
}

/**
 * Sums qty already shipped via long_term_consignment orders to this
 * account/location, per SKU. This is a running total of what's been sent,
 * not a true on-hand balance (nothing here subtracts prior consumption
 * orders) — good enough to seed a consumption order's line items, but if
 * you need an accurate "what's left on the shelf" figure, that needs a
 * proper stock-movement ledger (see the inventory-scanner phase).
 */
export async function getConsignmentBalance(accountId: string, locationId: string) {
  const supabase = await createClient();
  if (!accountId || !locationId) return { success: false as const, message: "Select Sold To and Ship To first." };

  const { data, error } = await supabase
    .from("orders")
    .select("order_lines(sku_id, qty, net_price, skus(name))")
    .eq("order_type", "long_term_consignment")
    .eq("account_id", accountId)
    .eq("location_id", locationId)
    .returns<{ order_lines: { sku_id: string; qty: number; net_price: number | null; skus: { name: string } | null }[] }[]>();

  if (error) return { success: false as const, message: error.message };

  const bySku = new Map<string, ConsignmentBalanceLine>();
  for (const order of data ?? []) {
    for (const line of order.order_lines) {
      const existing = bySku.get(line.sku_id);
      if (existing) {
        existing.consignmentQty += line.qty;
      } else {
        bySku.set(line.sku_id, {
          skuId: line.sku_id,
          skuName: line.skus?.name ?? "—",
          consignmentQty: line.qty,
          netPrice: line.net_price,
        });
      }
    }
  }

  return { success: true as const, lines: Array.from(bySku.values()) };
}
