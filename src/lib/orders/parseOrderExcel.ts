import "server-only";
import ExcelJS from "exceljs";

export interface ParsedOrderRow {
  itemName: string;
  qty: number;
  note: string;
}

export interface ParseOrderExcelResult {
  rows: ParsedOrderRow[];
  warnings: string[];
}

// Matches the template built by the order-template route: header row
// "Official ZEISS SKU" / "Quantity" / "Note (optional)", one data row per
// exact catalog item. Rows with a blank or zero quantity are simply
// skipped -- that's how a hospital user "leaves a product out" of the
// order, not an error condition.
export async function parseOrderExcel(buffer: Buffer): Promise<ParseOrderExcelResult> {
  const workbook = new ExcelJS.Workbook();
  // Same Buffer-identity mismatch between exceljs's bundled types and this
  // project's @types/node as parsePurchaseExcel.ts -- see that file for why
  // this cast is the right call here instead of fighting the types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const ws = workbook.worksheets[0];

  const rows: ParsedOrderRow[] = [];
  const warnings: string[] = [];

  if (!ws) {
    warnings.push("Couldn't find a worksheet in this file.");
    return { rows, warnings };
  }

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row
    const nameCell = row.getCell(1).value;
    const qtyCell = row.getCell(2).value;
    const noteCell = row.getCell(3).value;
    const name = typeof nameCell === "string" ? nameCell.trim() : "";
    const qty = typeof qtyCell === "number" ? qtyCell : typeof qtyCell === "string" ? parseFloat(qtyCell) : 0;
    const note = typeof noteCell === "string" ? noteCell.trim() : noteCell != null ? String(noteCell) : "";
    if (!name || !qty || qty <= 0) return;
    rows.push({ itemName: name, qty, note });
  });

  if (rows.length === 0) {
    warnings.push("No rows with a quantity filled in were found -- fill in the Quantity column next to the products you need.");
  }

  return { rows, warnings };
}
