import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AccountsAdmin } from "@/components/AccountsAdmin";

export default async function AccountsPage() {
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

  const admin = createAdminClient();
  const [{ data: accounts }, { data: locations }, { data: skus }, { data: loginProfiles }, { data: userList }] =
    await Promise.all([
      supabase.from("accounts").select("*").order("label"),
      supabase.from("account_locations").select("id, account_id, name").order("name"),
      supabase.from("skus").select("*").order("name"),
      supabase.from("profiles").select("id, account_id, location_id").eq("role", "hospital"),
      // profiles has no email column (that lives in auth.users, which
      // PostgREST never exposes) -- the admin client is the only way to
      // resolve id -> email for display here.
      admin.auth.admin.listUsers(),
    ]);

  const emailById = new Map(userList?.users.map((u) => [u.id, u.email ?? ""]) ?? []);
  const logins = (loginProfiles ?? []).map((p) => ({ ...p, email: emailById.get(p.id) ?? "—" }));

  return (
    <AccountsAdmin
      accounts={accounts ?? []}
      locations={locations ?? []}
      skus={skus ?? []}
      logins={logins}
    />
  );
}
