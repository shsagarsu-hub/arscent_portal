"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrderNotification } from "@/lib/email";
import { workOrderNo } from "@/lib/orders/workOrderNo";
import { ORDER_TYPE_LABELS } from "@/lib/orders/orderTypeLabels";
import type { BillingStatus, OrderType } from "@/lib/supabase/database.types";

// Domains used only for throwaway test/debug accounts created to drive the
// portal's own automated browser testing -- never a real inbox, so never a
// valid notification recipient regardless of what role the account holds.
const TEST_EMAIL_DOMAINS = ["@arscent-portal.test", "@arscent.local"];

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
  extraTo?: string[];
  cc?: string[];
}

// Order types a hospital login is allowed to place themselves -- the
// manager-only types (capital_sales, direct_ship, export, sales_return) and
// the two consumption types (created only via HospitalPortal's Log Usage,
// never through this action) are excluded. This is defense-in-depth: the
// `orders` INSERT RLS policy is the actual backstop and already rejects
// both a mismatched account_id and a manager-only order_type for a hospital
// caller, but failing fast here gives a clearer error than a raw RLS
// violation and avoids relying on RLS being the only thing standing between
// a hospital login and placing orders against another hospital's account.
const HOSPITAL_PLACEABLE_TYPES: OrderType[] = ["saleable", "long_term_consignment", "short_term_consignment"];

export async function createOrder(input: CreateOrderInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false as const, message: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role, account_id").eq("id", user.id).maybeSingle();
  if (!profile) return { success: false as const, message: "No profile found for this login." };
  if (profile.role === "hospital") {
    if (!HOSPITAL_PLACEABLE_TYPES.includes(input.orderType)) {
      return { success: false as const, message: "That order type isn't available to place directly." };
    }
    if (profile.account_id && profile.account_id !== input.accountId) {
      return { success: false as const, message: "You can only place orders against your own account." };
    }
  } else if (profile.role !== "account_manager" && profile.role !== "admin") {
    return { success: false as const, message: "Not authorized." };
  }

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
    poAttachmentUrl: input.poAttachmentUrl ?? null,
    extraTo: input.extraTo,
    cc: input.cc,
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
  poAttachmentUrl?: string | null;
  extraTo?: string[];
  cc?: string[];
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
    // Excludes the throwaway accounts created for in-app testing this
    // project (arscent-portal.test, arscent.local) -- neither domain is a
    // real deliverable inbox, and both roles were only ever needed to drive
    // the browser through manager-only screens, not to receive real order
    // notifications.
    const managerEmails = (managerProfiles ?? [])
      .map((p) => emailById.get(p.id))
      .filter((e): e is string => !!e && !TEST_EMAIL_DOMAINS.some((d) => e.endsWith(d)));

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
      poAttachmentUrl: input.poAttachmentUrl ?? null,
      extraTo: input.extraTo,
      cc: input.cc,
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
    .select("id, account_id, location_id, order_type, order_lines(id, sku_id, qty, net_price, source_order_line_id)")
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

  // HospitalPortal's Log Usage already resolved the exact catalog item +
  // batch for each of these lines (see commitUsageRows) and recorded it on
  // usage_log -- but a PO-linked entry skips the auto-billing trigger (it's
  // billed here instead, to avoid double-counting), so that trigger never
  // gets a chance to copy batch_number/item_master_id across the way it does
  // for an ad-hoc entry. Pulling it across here means the manager sees the
  // batch already filled in on this row instead of having to look it up and
  // retype it via Edit before Record will allow it through.
  //
  // Matched via consumption_order_line_id -- the CONSUMPTION order_line's
  // own id -- not source_order_line_id (the original shipment line), which
  // is not unique here: a single shipment line commonly gets drawn down
  // across several usage_log rows, one per physical serial, all sharing the
  // same source_order_line_id. Keying off that would hand every one of this
  // order's lines the same arbitrary batch instead of its own.
  const consumptionLineIds = order.order_lines.map((l) => l.id);
  const { data: usageRows } = await admin
    .from("usage_log")
    .select("consumption_order_line_id, batch_number, item_master_id")
    .in("consumption_order_line_id", consumptionLineIds);
  const usageByConsumptionLine = new Map((usageRows ?? []).map((u) => [u.consumption_order_line_id, u]));

  const today = new Date().toISOString().slice(0, 10);
  const { error: insertErr } = await admin.from("billing_requests").insert(
    order.order_lines.map((l) => {
      const usage = usageByConsumptionLine.get(l.id);
      return {
        order_line_id: l.id,
        account_id: order.account_id,
        location_id: order.location_id,
        sku_id: l.sku_id,
        entry_date: today,
        qty: l.qty,
        unit_price: l.net_price,
        amount: l.net_price != null ? l.net_price * l.qty : null,
        batch_number: usage?.batch_number ?? null,
        item_master_id: usage?.item_master_id ?? null,
      };
    })
  );
  if (insertErr) return { success: false as const, message: insertErr.message };

  revalidatePath("/manager");
  return { success: true as const };
}

interface PendingConsumption {
  usageLogId: string | null;
  billingRequestId: string | null;
  status: BillingStatus;
  consumptionOrderLineId: string | null;
  accountId: string;
  locationId: string;
}

/** Normalizes the two different rows each portal starts from -- the AM's
 * ConsignmentBillingPanel already has the billing_requests row (which, for
 * a PO-linked entry sent to Consignment, has no usage_log_id at all); the
 * hospital's own history only ever has the usage_log row, which may not
 * have a billing_requests row yet if it hasn't been sent to Consignment. */
async function resolvePendingConsumption(
  admin: ReturnType<typeof createAdminClient>,
  params: { usageLogId?: string; billingRequestId?: string }
): Promise<PendingConsumption | null> {
  if (params.usageLogId) {
    const { data: usage } = await admin
      .from("usage_log")
      .select("id, account_id, location_id, consumption_order_line_id")
      .eq("id", params.usageLogId)
      .maybeSingle();
    if (!usage) return null;

    // Two separate exact-match lookups instead of one combined .or() string --
    // a single .or() silently swallowed its own error here once (more than
    // one match, or a malformed filter) and the caller had no error check,
    // so an already-billed row's real status got lost and defaulted below to
    // "pending" -- which then let a real, already-invoiced consumption
    // record get deleted outright. Any error now propagates and blocks the
    // delete instead of being treated as "nothing found."
    const [byUsageLog, byOrderLine] = await Promise.all([
      admin.from("billing_requests").select("id, status").eq("usage_log_id", usage.id),
      usage.consumption_order_line_id
        ? admin.from("billing_requests").select("id, status").eq("order_line_id", usage.consumption_order_line_id)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (byUsageLog.error) throw new Error(`Couldn't verify this entry's billing status: ${byUsageLog.error.message}`);
    if (byOrderLine.error) throw new Error(`Couldn't verify this entry's billing status: ${byOrderLine.error.message}`);
    const matches = [...(byUsageLog.data ?? []), ...(byOrderLine.data ?? [])];
    // Prefer whichever match is furthest along (billed > requested > pending)
    // rather than an arbitrary one, in case duplicate rows exist.
    const rank: Record<BillingStatus, number> = { pending: 0, requested: 1, billed: 2 };
    const billing = matches.length > 0 ? matches.reduce((a, b) => (rank[b.status] > rank[a.status] ? b : a)) : null;

    return {
      usageLogId: usage.id,
      billingRequestId: billing?.id ?? null,
      status: billing?.status ?? "pending",
      consumptionOrderLineId: usage.consumption_order_line_id,
      accountId: usage.account_id,
      locationId: usage.location_id,
    };
  }
  if (params.billingRequestId) {
    const { data: billing } = await admin
      .from("billing_requests")
      .select("id, status, usage_log_id, order_line_id, account_id, location_id")
      .eq("id", params.billingRequestId)
      .maybeSingle();
    if (!billing) return null;
    return {
      usageLogId: billing.usage_log_id,
      billingRequestId: billing.id,
      status: billing.status,
      consumptionOrderLineId: billing.order_line_id,
      accountId: billing.account_id,
      locationId: billing.location_id,
    };
  }
  return null;
}

/**
 * Deletes one still-pending consumption entry, resolved either from the
 * usage_log side (hospital portal, deleting their own mistaken "Log Usage"
 * entry) or the billing_requests side (AM portal's Usage Log). An account
 * manager/admin can delete any account's entry; a hospital user only their
 * own account's (and own center's, unless their login is account-wide).
 *
 * Deliberately restricted to "pending" -- once a manager has clicked Record,
 * a real stock_movements row exists, and deleting the log entry underneath
 * it would silently leave stale/incorrect stock data, the same class of bug
 * this session already had to fix once (the LVPEI duplicate-serial DC bug).
 * An already-Recorded entry has to be corrected deliberately, not deleted
 * in passing.
 */
async function deletePendingConsumption(params: { usageLogId?: string; billingRequestId?: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false as const, message: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role, account_id, location_id").eq("id", user.id).maybeSingle();
  if (!profile) return { success: false as const, message: "Not authorized." };

  const admin = createAdminClient();
  let entry: PendingConsumption | null;
  try {
    entry = await resolvePendingConsumption(admin, params);
  } catch (err) {
    return { success: false as const, message: err instanceof Error ? err.message : "Couldn't verify this entry's status." };
  }
  if (!entry) return { success: false as const, message: "Entry not found." };

  const isManager = profile.role === "account_manager" || profile.role === "admin";
  const isOwnHospital =
    profile.role === "hospital" &&
    profile.account_id === entry.accountId &&
    (profile.location_id === null || profile.location_id === entry.locationId);
  if (!isManager && !isOwnHospital) return { success: false as const, message: "Not authorized." };

  if (entry.status !== "pending") {
    return {
      success: false as const,
      message: "This entry has already been recorded — it can no longer be deleted here.",
    };
  }

  if (entry.billingRequestId) {
    const { error } = await admin.from("billing_requests").delete().eq("id", entry.billingRequestId);
    if (error) return { success: false as const, message: error.message };
  }

  if (entry.consumptionOrderLineId) {
    const { data: line } = await admin.from("order_lines").select("order_id").eq("id", entry.consumptionOrderLineId).maybeSingle();
    const { error: lineErr } = await admin.from("order_lines").delete().eq("id", entry.consumptionOrderLineId);
    if (lineErr) return { success: false as const, message: lineErr.message };
    if (line?.order_id) {
      const { data: remaining } = await admin.from("order_lines").select("id").eq("order_id", line.order_id);
      if (!remaining || remaining.length === 0) {
        await admin.from("orders").delete().eq("id", line.order_id);
      }
    }
  }

  if (entry.usageLogId) {
    const { error: delUsageErr } = await admin.from("usage_log").delete().eq("id", entry.usageLogId);
    if (delUsageErr) return { success: false as const, message: delUsageErr.message };
  }

  revalidatePath("/manager");
  revalidatePath("/hospital");
  return { success: true as const };
}

/** Hospital portal: delete a usage entry the hospital logged themselves. */
export async function deleteOwnUsageEntry(usageLogId: string) {
  return deletePendingConsumption({ usageLogId });
}

/** AM portal: delete a pending Usage Log row from ConsignmentBillingPanel. */
export async function deletePendingBillingRequest(billingRequestId: string) {
  return deletePendingConsumption({ billingRequestId });
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false as const, message: "Not signed in." };
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
