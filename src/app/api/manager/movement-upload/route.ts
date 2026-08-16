import { createClient } from "@/lib/supabase/server";
import { parseMovementExcel } from "@/lib/inventory/parseMovementExcel";
import { parseCategoryLabel } from "@/lib/inventory/movementCategories";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || profile.role === "hospital") {
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
    parsed = await parseMovementExcel(buffer);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed to parse the file." }, { status: 500 });
  }
  if (parsed.rows.length === 0) {
    return Response.json(
      { error: "Couldn't find any valid rows in this file.", warnings: parsed.warnings },
      { status: 422 }
    );
  }

  // One batch query per lookup instead of one per row -- a real sheet here
  // can run into the hundreds of movements.
  const uniqueNames = Array.from(new Set(parsed.rows.map((r) => r.itemName)));
  const { data: items } = await supabase.from("item_master").select("id, name").in("name", uniqueNames);
  const itemByName = new Map((items ?? []).map((i) => [i.name, i.id]));

  const { data: accountRows } = await supabase.from("accounts").select("id, label");
  const accountByLabel = new Map((accountRows ?? []).map((a) => [a.label.toLowerCase(), a.id]));

  const rows = parsed.rows.map((r) => ({
    itemName: r.itemName,
    itemId: itemByName.get(r.itemName) ?? null,
    category: parseCategoryLabel(r.categoryLabel),
    categoryLabel: r.categoryLabel,
    qty: r.qty,
    hospitalLabel: r.hospitalLabel,
    hospitalId: r.hospitalLabel ? (accountByLabel.get(r.hospitalLabel.toLowerCase()) ?? null) : null,
    batchNumber: r.batchNumber,
    expiryDate: r.expiryDate,
    notes: r.notes,
  }));

  return Response.json({ rows, warnings: parsed.warnings });
}
