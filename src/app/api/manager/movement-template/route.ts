import "server-only";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, MOVEMENT_CATEGORY_KEYS } from "@/lib/inventory/movementCategories";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || profile.role === "hospital") {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  const { data: accountRows } = await supabase.from("accounts").select("label").order("label");
  const hospitalLabels = (accountRows ?? []).map((a) => a.label);

  // item_master has no per-account scoping the way hospital ordering does --
  // this is Arscent's own warehouse catalog, not one hospital's product
  // families -- so the reference sheet lists the whole thing, paginated past
  // PostgREST's 1000-row response cap the same way the hospital
  // order-template route does.
  const allItems: { name: string }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await supabase.from("item_master").select("name").order("name").range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    allItems.push(...page);
    if (page.length < PAGE) break;
  }

  const workbook = new ExcelJS.Workbook();

  const ws = workbook.addWorksheet("Movements");
  ws.columns = [
    { header: "Item (as per Tally)", key: "item", width: 55 },
    { header: "Category", key: "category", width: 22 },
    { header: "Qty", key: "qty", width: 10 },
    { header: "Hospital (if Sent/Returned)", key: "hospital", width: 32 },
    { header: "Batch Number", key: "batch", width: 20 },
    { header: "Expiry Date", key: "expiry", width: 16 },
    { header: "Notes", key: "notes", width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6EDFA" } };

  const categoryList = MOVEMENT_CATEGORY_KEYS.map((k) => CATEGORY_LABELS[k]);
  ws.addRow({
    item: "e.g. ZEISS CT LUCIA 621P TIP2.2 DPT 20.5",
    category: categoryList[1],
    qty: 10,
    hospital: hospitalLabels[0] ?? "",
    batch: "3S2504820043",
    expiry: "2027-06-30",
    notes: "example row -- delete before uploading",
  });

  // Dropdown validation down every fillable row -- 500 rows is comfortably
  // past what anyone pastes into one sheet at a time.
  for (let r = 2; r <= 500; r++) {
    ws.getCell(`B${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${categoryList.join(",")}"`],
    };
    if (hospitalLabels.length > 0) {
      ws.getCell(`D${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${hospitalLabels.join(",")}"`],
      };
    }
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const catalogWs = workbook.addWorksheet("Item Catalog (reference)");
  catalogWs.columns = [
    { header: "Item name -- copy the exact spelling into the Movements sheet", key: "name", width: 65 },
  ];
  catalogWs.getRow(1).font = { bold: true };
  catalogWs.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6EDFA" } };
  for (const item of allItems) catalogWs.addRow({ name: item.name });
  catalogWs.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="movement-template.xlsx"',
    },
  });
}
