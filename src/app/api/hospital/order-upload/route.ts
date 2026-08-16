import { createClient } from "@/lib/supabase/server";
import { parseOrderExcel } from "@/lib/orders/parseOrderExcel";
import { matchSkuFamily } from "@/lib/orders/skuFamilyMatch";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
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

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
    return Response.json({ error: "That's not an Excel file (.xlsx or .xlsm)." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File is too large (10MB max)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseOrderExcel(buffer);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to parse the file." },
      { status: 500 }
    );
  }

  const accountSkus = (await supabase.from("skus").select("id, name").eq("account_id", profile.account_id)).data ?? [];

  // Exact match against the real catalog -- the template's own rows are
  // exact item_master names, so a hospital that didn't retype anything gets
  // a clean match every time.
  const uniqueNames = Array.from(new Set(parsed.rows.map((r) => r.itemName)));
  const { data: itemMatches } = await supabase
    .from("item_master")
    .select("id, name")
    .in("name", uniqueNames.length > 0 ? uniqueNames : [""]);
  const itemByName = new Map((itemMatches ?? []).map((m) => [m.name, m]));

  const rows = parsed.rows.map((r) => {
    const item = itemByName.get(r.itemName);
    const sku = item ? matchSkuFamily(item.name, accountSkus) : null;
    return {
      itemName: r.itemName,
      qty: r.qty,
      note: r.note,
      itemId: item?.id ?? null,
      skuId: sku?.id ?? null,
      skuName: sku?.name ?? null,
    };
  });

  return Response.json({ rows, warnings: parsed.warnings });
}
