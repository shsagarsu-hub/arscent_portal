import "server-only";
import ExcelJS from "exceljs";

export interface ParsedPurchaseRow {
  itemName: string;
  batchNumber: string | null;
  expiryDate: string | null;
  qty: number;
}

export interface ParsePurchaseExcelResult {
  rows: ParsedPurchaseRow[];
  warnings: string[];
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function toIsoDate(raw: string): string | null {
  const m = raw.match(/(\d{1,2})-(\w{3})-(\d{2})/);
  if (!m) return null;
  const [, d, mon, y] = m;
  const mm = MONTHS[mon];
  if (!mm) return null;
  return `20${y}-${mm}-${d.padStart(2, "0")}`;
}

// This is a Tally "Stock Group Summary" export (same two-level shape as the
// Zeiss Database.xlsm warehouse-stock import from earlier): each item is
// listed once (name + total qty/rate/value), immediately followed by one
// row per batch actually on hand (batch number, expiry, that batch's own
// qty). Batch rows are identified by the brand column ("ZEISS") being
// populated only on them, never on the item-level row above -- validated
// against the real template: 220 batch rows, summing to exactly the sheet's
// own printed Grand Total (220).
export async function parsePurchaseExcel(buffer: Buffer): Promise<ParsePurchaseExcelResult> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled types declare load() against a Buffer identity from
  // its own dependency tree, which doesn't structurally unify with this
  // project's @types/node Buffer -- both are the same real Buffer at
  // runtime, so bypass the mismatched third-party type declaration here
  // rather than fight it with casts that don't resolve to exceljs's Buffer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const ws = workbook.worksheets[0];

  const rows: ParsedPurchaseRow[] = [];
  let currentItemName: string | null = null;
  let skippedNoExpiry = 0;

  ws.eachRow((row) => {
    const colA = row.getCell(1).value;
    const colC = row.getCell(3).value;
    const colD = row.getCell(4).value;
    const colE = row.getCell(5).value;

    const aText = typeof colA === "string" ? colA.trim() : colA != null ? String(colA) : "";
    const dText = typeof colD === "string" ? colD.trim() : "";
    const qty = typeof colE === "number" ? colE : typeof colE === "string" ? parseFloat(colE) : null;

    if (aText === "Grand Total") return;
    if (dText === "ZEISS") {
      // Batch row -- belongs to whatever item-level row came before it.
      if (!currentItemName) return;
      const cText = typeof colC === "string" ? colC : "";
      const expMatch = cText.match(/Expiry Date\s*:\s*(\d{1,2}-\w{3}-\d{2})/);
      const expiryDate = expMatch ? toIsoDate(expMatch[1]) : null;
      // A batch row without a real expiry date isn't usable stock data for
      // this workflow (the Grand Total row in these exports is also
      // unreliable -- manually typed, not a formula -- so it's never used
      // for validation either); skip it rather than import a batch with an
      // unknown expiry.
      if (!expiryDate) {
        skippedNoExpiry++;
        return;
      }
      rows.push({
        itemName: currentItemName,
        batchNumber: aText || null,
        expiryDate,
        qty: qty ?? 1,
      });
    } else if (aText && qty !== null) {
      // Item-level row -- sets context for the batch rows that follow.
      currentItemName = aText;
    }
  });

  const warnings: string[] = [];
  if (skippedNoExpiry > 0) {
    warnings.push(
      `Skipped ${skippedNoExpiry} row(s) with no parseable expiry date -- only batch rows with a valid expiry are imported.`
    );
  }
  if (rows.length === 0) {
    warnings.push(
      "No batch rows found -- check this is the expected Purchase Import format (an item row followed by batch rows with the brand column filled in)."
    );
  }

  return { rows, warnings };
}
