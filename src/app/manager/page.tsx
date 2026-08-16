import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ManagerPortal } from "@/components/ManagerPortal";

export default async function ManagerPage() {
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

  return <ManagerPortal canManageAccounts />;
}
