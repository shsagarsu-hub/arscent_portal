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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || (profile.role !== "admin" && profile.role !== "account_manager")) {
    redirect("/");
  }
  return profile.role as "admin" | "account_manager";
}

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function int(formData: FormData, key: string) {
  const v = str(formData, key);
  return v === null ? null : parseInt(v, 10);
}

export async function createAccount(formData: FormData) {
  await requireManager();
  const admin = createAdminClient();

  const code = str(formData, "code");
  const label = str(formData, "label");
  if (!code || !label) throw new Error("Code and label are required.");

  const { error } = await admin.from("accounts").insert({
    code,
    label,
    commitment_start: str(formData, "commitment_start"),
    commitment_period_months: int(formData, "commitment_period_months"),
    iol_payment_days: int(formData, "iol_payment_days"),
    license_payment_term: str(formData, "license_payment_term"),
    interest_rate: str(formData, "interest_rate"),
    review_cadence: str(formData, "review_cadence"),
    key_dates: str(formData, "key_dates"),
    notes: str(formData, "notes"),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/accounts");
}

export async function updateAccount(accountId: string, formData: FormData) {
  await requireManager();
  const admin = createAdminClient();

  const { error } = await admin
    .from("accounts")
    .update({
      label: str(formData, "label") ?? undefined,
      commitment_start: str(formData, "commitment_start"),
      commitment_period_months: int(formData, "commitment_period_months"),
      iol_payment_days: int(formData, "iol_payment_days"),
      license_payment_term: str(formData, "license_payment_term"),
      interest_rate: str(formData, "interest_rate"),
      review_cadence: str(formData, "review_cadence"),
      key_dates: str(formData, "key_dates"),
      notes: str(formData, "notes"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) throw new Error(error.message);

  revalidatePath("/accounts");
}

export async function createLocation(accountId: string, formData: FormData) {
  await requireManager();
  const admin = createAdminClient();

  const name = str(formData, "name");
  if (!name) throw new Error("Location name is required.");

  const { error } = await admin.from("account_locations").insert({ account_id: accountId, name });
  if (error) throw new Error(error.message);

  revalidatePath("/accounts");
}

export async function createLocationLogin(accountId: string, locationId: string | null, formData: FormData) {
  await requireManager();
  const admin = createAdminClient();

  const email = str(formData, "email")?.toLowerCase() ?? null;
  const password = str(formData, "password");
  if (!email || !password) throw new Error("Email and password are required.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) throw new Error(createErr.message);

  const { error: profileErr } = await admin.from("profiles").insert({
    id: created.user.id,
    role: "hospital",
    account_id: accountId,
    location_id: locationId,
  });
  if (profileErr) {
    // Don't leave an orphaned auth user with no profile — that login would
    // exist but resolve to no account/location anywhere in the portal.
    await admin.auth.admin.deleteUser(created.user.id);
    throw new Error(profileErr.message);
  }

  revalidatePath("/accounts");
}

/**
 * account_manager and admin are otherwise treated as equivalent everywhere
 * in this app, but login management is the one place that distinction
 * actually matters: without this, any account_manager could call
 * updateLogin/deleteLogin with an arbitrary userId -- including another
 * account_manager's or an admin's -- and hijack or delete that login. Only
 * an actual admin may touch a non-hospital login; account_manager is
 * restricted to the hospital logins /accounts already scopes it to.
 */
async function requireManagerCanTarget(callerRole: "admin" | "account_manager", targetUserId: string) {
  if (callerRole === "admin") return;
  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("role").eq("id", targetUserId).maybeSingle();
  if (!target || target.role !== "hospital") {
    throw new Error("Only an admin can manage this login.");
  }
}

export async function updateLogin(userId: string, formData: FormData) {
  const callerRole = await requireManager();
  await requireManagerCanTarget(callerRole, userId);
  const admin = createAdminClient();

  const email = str(formData, "email")?.toLowerCase() ?? null;
  const password = str(formData, "password");
  if (!email) throw new Error("Email is required.");
  if (password && password.length < 8) throw new Error("Password must be at least 8 characters.");

  const { error } = await admin.auth.admin.updateUserById(userId, {
    email,
    ...(password ? { password } : {}),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/accounts");
}

export async function deleteLogin(userId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (user.id === userId) throw new Error("You can't delete the login you're currently signed in with.");
  const callerRole = await requireManager();
  await requireManagerCanTarget(callerRole, userId);

  const admin = createAdminClient();

  // Delete the profile first -- deleting the auth user alone would leave an
  // orphaned profile row (no FK cascade from auth.users into public.profiles).
  const { error: profileErr } = await admin.from("profiles").delete().eq("id", userId);
  if (profileErr) throw new Error(profileErr.message);

  const { error: userErr } = await admin.auth.admin.deleteUser(userId);
  if (userErr) throw new Error(userErr.message);

  revalidatePath("/accounts");
}

export async function upsertSku(
  accountId: string,
  skuId: string | null,
  data: { name: string; price_ex_gst: string; transfer_price: string; commitment_per_month: string }
) {
  await requireManager();
  const admin = createAdminClient();

  const name = data.name.trim();
  if (!name) throw new Error("SKU name is required.");

  const payload = {
    account_id: accountId,
    name,
    price_ex_gst: data.price_ex_gst.trim() === "" ? null : parseFloat(data.price_ex_gst),
    transfer_price: data.transfer_price.trim() === "" ? null : parseFloat(data.transfer_price),
    commitment_per_month:
      data.commitment_per_month.trim() === "" ? null : parseInt(data.commitment_per_month, 10),
    updated_at: new Date().toISOString(),
  };

  const { error } = skuId
    ? await admin.from("skus").update(payload).eq("id", skuId)
    : await admin.from("skus").insert(payload);
  if (error) throw new Error(error.message);

  revalidatePath("/accounts");
}

export async function deleteSku(skuId: string) {
  await requireManager();
  const admin = createAdminClient();

  const { error } = await admin.from("skus").delete().eq("id", skuId);
  if (error) {
    // 23503 = foreign key violation — usage_log/order_lines/billing_requests/
    // tally_invoice_lines all reference skus with no cascade, on purpose:
    // deleting a product with real transaction history would either fail
    // (as it does here) or silently orphan those historical records if it
    // didn't. The raw Postgres constraint-name message isn't useful to a
    // reader here, so give the actual reason instead.
    if (error.code === "23503") {
      throw new Error(
        "Can't delete this product — it has usage, orders, or invoices recorded against it. Rename or reprice it instead of deleting it."
      );
    }
    throw new Error(error.message);
  }

  revalidatePath("/accounts");
}
