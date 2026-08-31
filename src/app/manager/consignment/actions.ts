"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendUsageInvoiceEmail } from "@/lib/email";

/**
 * Every real hospital login for an account/location -- an account-wide
 * login (location_id null on the profile) counts for any location under
 * that account. Kept local (not exported) since it takes a non-serializable
 * admin client -- orders/actions.ts has its own copy for the same reason
 * (see that file's docstring on the constraint).
 */
async function resolveHospitalEmails(admin: ReturnType<typeof createAdminClient>, accountId: string, locationId: string | null) {
  const [{ data: hospitalProfiles }, { data: userList }] = await Promise.all([
    admin.from("profiles").select("id, location_id").eq("role", "hospital").eq("account_id", accountId),
    admin.auth.admin.listUsers(),
  ]);
  const emailById = new Map(userList?.users.map((u) => [u.id, u.email]) ?? []);
  return [
    ...new Set(
      (hospitalProfiles ?? [])
        .filter((p) => p.location_id === null || p.location_id === locationId)
        .map((p) => emailById.get(p.id))
        .filter((e): e is string => !!e)
    ),
  ];
}

/** Prefills the To field when the invoice-saved step opens -- the account
 * manager can still edit or add Cc before actually sending. */
export async function getDefaultUsageInvoiceRecipients(accountId: string, locationId: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false as const, message: "Not signed in." };

  const admin = createAdminClient();
  const to = await resolveHospitalEmails(admin, accountId, locationId);
  return { success: true as const, to };
}

/**
 * Emails one hospital+center+day's invoice to the hospital, with the account
 * manager's own To/Cc (prefilled from getDefaultUsageInvoiceRecipients
 * above, editable before sending) -- the "Send Invoice Email" button in
 * Pending Invoice, once a group's invoice file has been uploaded. Every
 * billing_requests row passed in shares the same account/location/date/
 * invoice by construction (they were just billed together as one group in
 * ConsignmentBillingPanel), so any one of them could resolve the
 * account/location/invoice -- this fetches all of them to build an accurate
 * per-SKU breakdown in the email body.
 */
export async function sendUsageInvoiceEmailAction(billingRequestIds: string[], to: string[], cc: string[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false as const, message: "Not signed in." };
  if (billingRequestIds.length === 0) return { success: false as const, message: "Nothing to send." };
  if (to.length === 0) return { success: false as const, message: "Add at least one To recipient." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "account_manager" && profile.role !== "admin")) {
    return { success: false as const, message: "Not authorized." };
  }

  const admin = createAdminClient();
  const { data: rows, error: billingErr } = await admin
    .from("billing_requests")
    .select("entry_date, qty, account_id, location_id, invoice_attachment_url, accounts(label), account_locations(name), skus(name)")
    .in("id", billingRequestIds);
  if (billingErr || !rows || rows.length === 0) return { success: false as const, message: billingErr?.message ?? "Entry not found." };
  const [billing] = rows;
  if (!billing.invoice_attachment_url) return { success: false as const, message: "Upload the invoice first." };

  // Roll every row into one line per SKU family, qty summed -- mirrors how
  // the group itself was billed (one invoice, many lenses).
  const bySku = new Map<string, number>();
  for (const r of rows) {
    const name = r.skus?.name ?? "—";
    bySku.set(name, (bySku.get(name) ?? 0) + r.qty);
  }
  const items = Array.from(bySku.entries()).map(([skuName, qty]) => ({ skuName, qty }));

  const result = await sendUsageInvoiceEmail({
    accountLabel: billing.accounts?.label ?? "—",
    locationName: billing.account_locations?.name ?? null,
    items,
    entryDate: billing.entry_date,
    to,
    cc,
    invoiceUrl: billing.invoice_attachment_url,
  });

  if (!result.sent) {
    return { success: false as const, message: "reason" in result ? (result.reason ?? "Couldn't send.") : (result.error ?? "Couldn't send.") };
  }
  return { success: true as const, recipients: result.recipients ?? [] };
}
