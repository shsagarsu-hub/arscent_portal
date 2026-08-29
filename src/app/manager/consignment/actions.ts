"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendUsageInvoiceEmail } from "@/lib/email";

/**
 * Emails one consignment usage entry's invoice to the hospital -- the
 * "Send Invoice Email" button in Pending Invoice, next to a billing_request
 * once its invoice file has been uploaded. Uses the admin client purely to
 * resolve the hospital's auth.users email (not exposed to a regular
 * client), same reasoning as notifyOrderPlaced in orders/actions.ts.
 */
export async function sendUsageInvoiceEmailAction(billingRequestId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false as const, message: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "account_manager" && profile.role !== "admin")) {
    return { success: false as const, message: "Not authorized." };
  }

  const admin = createAdminClient();
  const { data: billing, error: billingErr } = await admin
    .from("billing_requests")
    .select("entry_date, qty, account_id, location_id, invoice_attachment_url, accounts(label), account_locations(name), skus(name)")
    .eq("id", billingRequestId)
    .maybeSingle();
  if (billingErr || !billing) return { success: false as const, message: billingErr?.message ?? "Entry not found." };
  if (!billing.invoice_attachment_url) return { success: false as const, message: "Upload the invoice first." };

  // Every hospital login for this account/location -- an account-wide login
  // (location_id null) is included for any location under that account.
  const [{ data: hospitalProfiles }, { data: userList }] = await Promise.all([
    admin.from("profiles").select("id, location_id").eq("role", "hospital").eq("account_id", billing.account_id),
    admin.auth.admin.listUsers(),
  ]);
  const emailById = new Map(userList?.users.map((u) => [u.id, u.email]) ?? []);
  const to = [
    ...new Set(
      (hospitalProfiles ?? [])
        .filter((p) => p.location_id === null || p.location_id === billing.location_id)
        .map((p) => emailById.get(p.id))
        .filter((e): e is string => !!e)
    ),
  ];
  if (to.length === 0) return { success: false as const, message: "Couldn't find a hospital login to email for this account/location." };

  const result = await sendUsageInvoiceEmail({
    accountLabel: billing.accounts?.label ?? "—",
    locationName: billing.account_locations?.name ?? null,
    skuName: billing.skus?.name ?? "—",
    qty: billing.qty,
    entryDate: billing.entry_date,
    to,
    invoiceUrl: billing.invoice_attachment_url,
  });

  if (!result.sent) {
    return { success: false as const, message: "reason" in result ? (result.reason ?? "Couldn't send.") : (result.error ?? "Couldn't send.") };
  }
  return { success: true as const, recipients: result.recipients ?? [] };
}
