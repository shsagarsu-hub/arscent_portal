import { createClient } from "@/lib/supabase/server";
import { familyPatternsFor, matchSkuFamily } from "@/lib/orders/skuFamilyMatch";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, account_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "hospital" || !profile.account_id) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ items: [] });

  const { data: accountSkus } = await supabase.from("skus").select("id, name").eq("account_id", profile.account_id);
  const patterns = familyPatternsFor(accountSkus ?? []);
  if (patterns.length === 0) return Response.json({ items: [] });

  // Match each word independently (AND'd together), not the phrase as one
  // contiguous substring -- real names put the model number between the
  // family and the diopter (e.g. "CT LUCIA 621P TIP2.2 DPT 20.5"), so a
  // natural query like "CT LUCIA DPT 20" would never appear as one run of
  // characters even though every word in it is genuinely present.
  const tokens = q.split(/\s+/).filter(Boolean);
  let query = supabase.from("item_master").select("id, name");
  for (const token of tokens) {
    query = query.ilike("name", `%${token}%`);
  }
  // Cast a wider net than the final page size -- the scoping filter below
  // runs in JS (item_master has no family column to filter on in SQL), so a
  // narrow match here could otherwise leave nothing after scoping.
  const { data: candidates } = await query.order("name").limit(200);

  const scoped = (candidates ?? []).filter((c) => patterns.some((test) => test(c.name.toUpperCase())));
  const items = scoped.slice(0, 30).map((c) => {
    const sku = matchSkuFamily(c.name, accountSkus ?? []);
    return { id: c.id, name: c.name, skuId: sku?.id ?? null, skuName: sku?.name ?? null };
  });

  return Response.json({ items });
}
