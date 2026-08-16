import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HospitalPortal } from "@/components/HospitalPortal";

export default async function HospitalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, account_id, location_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "hospital" || !profile.account_id) {
    redirect("/");
  }

  const [{ data: account }, { data: locations }, { data: skus }] = await Promise.all([
    supabase.from("accounts").select("label").eq("id", profile.account_id).single(),
    supabase.from("account_locations").select("id, name").eq("account_id", profile.account_id).order("name"),
    supabase
      .from("skus")
      .select("id, name, price_ex_gst")
      .eq("account_id", profile.account_id)
      .order("name"),
  ]);

  const location = profile.location_id ? (locations ?? []).find((l) => l.id === profile.location_id) : null;

  return (
    <HospitalPortal
      accountId={profile.account_id}
      locationId={profile.location_id}
      accountLabel={account?.label ?? ""}
      locationName={location?.name ?? null}
      locations={locations ?? []}
      skus={skus ?? []}
      userId={user.id}
    />
  );
}
