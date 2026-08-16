import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function getOrderFormData() {
  const supabase = await createClient();
  const [{ data: accounts }, { data: locations }, { data: skus }] = await Promise.all([
    supabase.from("accounts").select("id, code, label").order("label"),
    supabase.from("account_locations").select("id, account_id, name").order("name"),
    supabase.from("skus").select("id, account_id, name, price_ex_gst").order("name"),
  ]);

  return { accounts: accounts ?? [], locations: locations ?? [], skus: skus ?? [] };
}
