import "server-only";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { familyPatternsFor } from "@/lib/orders/skuFamilyMatch";

export async function GET() {
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

  const { data: accountSkus } = await supabase.from("skus").select("id, name").eq("account_id", profile.account_id);
  const patterns = familyPatternsFor(accountSkus ?? []);

  // item_master has no per-account or per-family column to filter on in SQL,
  // so pull the whole catalog once (~5-6k rows, sub-second either way) and
  // scope it down to this hospital's own families in JS. PostgREST caps
  // every response at 1000 rows server-side regardless of the requested
  // .limit(), so a single call silently truncates the ~5,444-row catalog --
  // page through with .range() until a short page confirms we're done.
  const allItems: { name: string }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await supabase.from("item_master").select("name").order("name").range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    allItems.push(...page);
    if (page.length < PAGE) break;
  }
  const items = allItems.filter((r) => patterns.some((test) => test(r.name.toUpperCase())));

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Order");
  ws.columns = [
    { header: "Official ZEISS SKU", key: "name", width: 55 },
    { header: "Quantity", key: "qty", width: 12 },
    { header: "Note (optional)", key: "note", width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6EDFA" } };

  for (const item of items) {
    ws.addRow({ name: item.name, qty: null, note: "" });
  }
  ws.getColumn("qty").numFmt = "0";
  ws.autoFilter = { from: "A1", to: `C${items.length + 1}` };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="order-template.xlsx"',
    },
  });
}
