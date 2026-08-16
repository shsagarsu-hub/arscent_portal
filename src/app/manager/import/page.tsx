import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TallyReviewTable } from "@/components/tally/TallyReviewTable";

export default async function ImportPage() {
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

  if (!profile || profile.role === "hospital") redirect("/");

  const [{ data: accounts }, { data: skus }] = await Promise.all([
    supabase.from("accounts").select("id, label").order("label"),
    supabase.from("skus").select("id, name, account_id").order("name"),
  ]);

  return <TallyReviewTable accounts={accounts ?? []} skus={skus ?? []} />;
}
