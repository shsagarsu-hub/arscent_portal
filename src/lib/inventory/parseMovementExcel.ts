import "server-only";
import ExcelJS from "exceljs";

export interface ParsedMovementRow {
  itemName: string;
  categoryLabel: string;
  qty: number;
  hospitalLabel: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
  notes: string | null;
}

export interface ParseMovementExcelResult {
  rows: ParsedMovementRow[];
  warnings: string[];
}

// Matches the template built by the movement-template route: header row
// "Item (as per Tally)" / "Category" / "Qty" / "Hospital (if Sent/Returned)" /
// "Batch Number" / "Expiry Date" / "Notes". Rows with a blank item name or a
// zero/blank quantity are simply skipped -- same convention as
// parseOrderExcel.ts / parsePurchaseExcel.ts.
export async function parseMovementExcel(buffer: Buffer): Promise<ParseMovementExcelResult> {
  const workbook = new ExcelJS.Workbook();
  // Same Buffer-identity mismatch between exceljs's bundled types and this
  // project's @types/node as parsePurchaseExcel.ts -- see that file for why
  // this cast is the right call here instead of fighting the types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const ws = workbook.worksheets[0];

  const rows: ParsedMovementRow[] = [];
  const warnings: string[] = [];

  if (!ws) {
    warnings.push("Couldn't find a worksheet in this file.");
    return { rows, warnings };
  }

  const cellStr = (v: unknown) => (typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "");

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row
    const itemName = cellStr(row.getCell(1).value);
    const categoryLabel = cellStr(row.getCell(2).value);
    const qtyCell = row.getCell(3).value;
    const qty = typeof qtyCell === "number" ? qtyCell : parseFloat(cellStr(qtyCell));
    const hospitalLabel = cellStr(row.getCell(4).value) || null;
    const batchNumber = cellStr(row.getCell(5).value) || null;
    const expiryCell = row.getCell(6).value;
    const expiryDate = expiryCell instanceof Date ? expiryCell.toISOString().slice(0, 10) : cellStr(expiryCell) || null;
    const notes = cellStr(row.getCell(7).value) || null;
    if (!itemName || !qty || qty <= 0) return;
    rows.push({ itemName, categoryLabel, qty, hospitalLabel, batchNumber, expiryDate, notes });
  });

  if (rows.length === 0) {
    warnings.push("No valid rows found -- fill in Item, Category, and Qty for each movement.");
  }

  return { rows, warnings };
}
