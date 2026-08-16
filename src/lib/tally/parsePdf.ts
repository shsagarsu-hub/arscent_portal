import "server-only";

// The real, confirmed-live root cause of the original production crash:
// pdfjs-dist (used internally by pdf-parse) references the browser-native
// DOMMatrix class at MODULE scope, not inside a function -- so merely
// importing pdf-parse throws in any environment that doesn't define
// DOMMatrix as a global, which Vercel's Node.js function runtime doesn't.
// Confirmed via Vercel's own runtime logs: "Failed to load external module
// pdf-parse: ReferenceError: DOMMatrix is not defined", crashing in ~8ms --
// before any of this file's own code ever ran.
//
// A static top-level `import { PDFParse } from "pdf-parse"` is hoisted
// ahead of everything else in this file, so there's no way to set the
// polyfill first with one -- only a dynamic import, done after the
// polyfill is in place, actually orders this correctly.
//
// (An earlier attempt also explicitly pinned pdf-parse's worker file via
// PDFParse.setWorker(), computed through require.resolve("pdf-parse") --
// that turned out to be solving a problem that didn't exist: every local
// test worked fine without it, and worse, require.resolve() returns
// Turbopack's internal numeric module id rather than a real filesystem path
// in this app's deployed runtime, not just during Next's build step as
// first assumed -- confirmed live, it crashed with "path argument must be
// of type string, received type number" the moment the DOMMatrix fix let
// execution reach it. Removed entirely; pdf-parse's own default worker
// resolution has worked in every test since.)
let pdfParseModule: typeof import("pdf-parse") | null = null;
async function loadPdfParse() {
  if (pdfParseModule) return pdfParseModule;
  if (!("DOMMatrix" in globalThis)) {
    const { default: CSSMatrix } = await import("dommatrix");
    (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = CSSMatrix;
  }
  pdfParseModule = await import("pdf-parse");
  return pdfParseModule;
}

// Ported from a Python/pdfplumber prototype and re-validated against this
// library's very different text layout (tab-delimited columns in a
// different order, vs. pdfplumber's flat left-to-right reading order) --
// every invoice this was built against was cross-checked by summing parsed
// line-item quantities against that invoice's own printed "Total N <unit>"
// line, so this isn't a guess at the format, it's fitted to real output.

export type TallyDocumentType = "invoice" | "credit_note" | "debit_note";

export interface ParsedBatch {
  batchNumber: string;
  expiryDate: string | null;
  qty: number;
}

export interface ParsedInvoiceLine {
  invoiceNo: string;
  date: string;
  buyerRaw: string;
  descriptionRaw: string;
  qty: number;
  rate: number;
  batches: ParsedBatch[];
  documentType: TallyDocumentType;
  // Only set for credit_note/debit_note -- the invoice number it adjusts,
  // so the two stay linked for audit even though they're stored as separate
  // tally_invoice_lines rows (each keeps its own invoice_no -- the note's
  // own number, e.g. "AR/CR/26-27/25" -- so it doesn't collide with or
  // overwrite the original invoice's lines on re-import).
  relatedInvoiceNo: string | null;
}

export interface ParsedInvoice {
  invoiceNo: string;
  date: string;
  buyer: string | null;
  items: { description: string; qty: number; rate: number; batches: ParsedBatch[] }[];
  printedTotal: number | null;
}

export interface ParsePdfResult {
  lines: ParsedInvoiceLine[];
  warnings: string[];
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function toIsoDate(raw: string): string {
  const m = raw.match(/(\d{1,2})-(\w{3})-(\d{2})/);
  if (!m) return raw;
  const [, d, mon, y] = m;
  const mm = MONTHS[mon];
  if (!mm) return raw;
  return `20${y}-${mm}-${d.padStart(2, "0")}`;
}

// Batch lines use numeric D-M-YYYY ("31-3-2028"), a different format from
// the invoice date's D-Mon-YY ("31-Jul-26") handled above.
function toIsoDateNumeric(raw: string): string | null {
  const m = raw.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Each "Batch : <no>, Exp: <date> <qty> <unit>" line carries its own
// quantity -- for lens items that's one batch line per unit (six "1 Nos"
// lines for a qty-6 item), but for bundled packs it's a single line
// covering the whole quantity ("5 Pack"). Trusting each line's own stated
// qty (rather than assuming "N batch lines = N units") handles both without
// special-casing, and lets the inventory movements this feeds be as
// granular as the source data actually is.
const BATCH_RE = /Batch\s*:\s*([^\s,]+),\s*Exp:\s*(\d{1,2}-\d{1,2}-\d{4})\s+(\d+(?:\.\d+)?)/g;

function extractBatches(chunk: string): ParsedBatch[] {
  return [...chunk.matchAll(BATCH_RE)].map((m) => ({
    batchNumber: m[1],
    expiryDate: toIsoDateNumeric(m[2]),
    qty: parseFloat(m[3]),
  }));
}

// A new item starts on a line with a leading Sl No. (1-2 digits) followed --
// possibly through an item code made of digits/dashes -- by the product
// name. Every real product in these invoices starts with "ZEISS" (lens
// products) or "Treatment" (SMILE Pro packs/licences). Matched against the
// literal invoice number rather than a hand-tracked expected sequence,
// since multi-page invoices continue their Sl No. across PDF pages (9, 10,
// 11...) instead of resetting to 1 on each new page.
const ITEM_START_RE = /(\d{1,2})\s+(?:[\d-]+\s*)?(ZEISS|Treatment|treatment)/g;
const UNIT_WORD = "(?:Nos|Pack|Kits|Bottles|Tests|Pcs|Vials|Box|Piece|Unit)";
// Quantity is identified by "<n> <unit>" immediately followed by a tab and
// a GST% -- the one column adjacency that holds regardless of whether the
// earlier Amount/per-unit/Rate columns are present for that line (they're
// blank for a few real lines, e.g. a bundled licence with no separate
// price).
const QTY_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT_WORD}s?\\s*\\t\\s*\\d+(?:\\.\\d+)?\\s*%`, "i");

function parsePage(text: string): ParsedInvoice | null {
  const invMatch = text.match(/([A-Z]{2,4}\/\d{2}-\d{2}\/\d+)[\s\S]*?Dated\s*\n\s*(\d{1,2}-\w{3}-\d{2})/);
  if (!invMatch) return null;
  const invoiceNo = invMatch[1];
  const date = toIsoDate(invMatch[2]);

  let buyer: string | null = null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "Consignee (Ship to)") {
      buyer = lines[i + 1]?.trim() ?? null;
      break;
    }
  }

  // The whitespace between "No." and "Rate" isn't always a literal space --
  // some invoices (e-Invoices with an IRN/Ack No. header, at least) wrap
  // this table header across a tab instead, so this has to match either.
  const startMarkerMatch = text.match(/No\.\s*Rate/);
  if (!startMarkerMatch) return { invoiceNo, date, buyer, items: [], printedTotal: null };
  const startIdx = startMarkerMatch.index!;

  // fullBody keeps going past the items block -- the printed "Total N Nos"
  // line used for validation comes after SGST/CGST/Rounding, outside the
  // truncated `body` used for item parsing.
  const fullBody = text.slice(startIdx + startMarkerMatch[0].length);
  let endIdx = fullBody.length;
  for (const marker of ["SGST Output", "CGST Output", "IGST Output", "continued to page number"]) {
    const i = fullBody.indexOf(marker);
    if (i !== -1 && i < endIdx) endIdx = i;
  }
  const body = fullBody.slice(0, endIdx);

  const starts = [...body.matchAll(ITEM_START_RE)];
  const chunks: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const nameStart = s.index! + s[0].length - s[2].length; // start of "ZEISS"/"Treatment"
    const chunkEnd = i + 1 < starts.length ? starts[i + 1].index! : body.length;
    chunks.push(body.slice(nameStart, chunkEnd));
  }

  const items: { description: string; qty: number; rate: number; batches: ParsedBatch[] }[] = [];
  for (const chunk of chunks) {
    const qtyMatch = chunk.match(QTY_RE);
    const preQtyText = qtyMatch ? chunk.slice(0, qtyMatch.index) : chunk;

    // Column order is [description+Amount] \t [per-unit] \t [Rate] \t [Qty].
    // Only the text before the FIRST tab is description+Amount -- cutting
    // there (rather than stripping one trailing money token from the whole
    // pre-qty text) avoids leaving the per-unit label or a second money
    // value stuck on the end of the description.
    const firstTab = preQtyText.indexOf("\t");
    const descRaw = firstTab === -1 ? preQtyText : preQtyText.slice(0, firstTab);
    let description = descRaw.replace(/\s+/g, " ").trim();
    description = description.replace(/\s+[\d,]+\.\d{2}\s*$/, "").trim();
    description = description.replace(/\(\s+/g, "(").trim();
    // A decimal number occasionally wraps mid-number in the source PDF
    // ("SE+23." then a line break then "00 CYL03.0") -- rejoin it.
    description = description.replace(/(\d)\.\s+(\d)/g, "$1.$2");

    if (!qtyMatch || !description) continue;
    const qty = parseFloat(qtyMatch[1]);

    let rate = 0;
    const moneyMatches = [...preQtyText.matchAll(/[\d,]+\.\d{2}/g)];
    if (moneyMatches.length > 0) {
      rate = parseFloat(moneyMatches[moneyMatches.length - 1][0].replace(/,/g, ""));
    }

    items.push({ description, qty, rate, batches: extractBatches(chunk) });
  }

  let printedTotal: number | null = null;
  const totalMatch = fullBody.match(/Total\s+[^\d\s]+([\d,]+\.\d{2})\s*\t\s*(\d+(?:\.\d+)?)\s+\S+/);
  if (totalMatch) printedTotal = parseFloat(totalMatch[2]);

  return { invoiceNo, date, buyer, items, printedTotal };
}

export interface ParsedAdjustment {
  noteNo: string;
  date: string;
  buyer: string | null;
  relatedInvoiceNo: string | null;
  // Ledger-level line items -- a credit/debit note doesn't itemize a
  // specific product/quantity the way a sales invoice does (confirmed
  // against a real one: "1 GST Sales-22  4,761.90  0 %  90213900" -- no
  // per-unit rate, no quantity, "GST Sales-22" is the Tally ledger name it
  // was booked under, not a product). Each entry here is one such ledger
  // line's pre-GST amount.
  particulars: { description: string; amount: number }[];
}

// Same "Sl  <text>  <tab>  <money>..." shape as an invoice's item table, but
// without a product name to anchor on (ITEM_START_RE/QTY_RE don't apply --
// there's no "ZEISS"/"Treatment" and no "<qty> <unit>" token on these
// lines). Anchoring on a line-leading Sl No. instead is enough: every real
// particulars line starts with one, and the GST/tax breakdown lines below
// it ("CGST Output", "SGST Output", "Total") don't.
const ADJUSTMENT_LINE_RE = /^(\d{1,2})\s+([^\t\n]+?)\s*\t\s*([\d,]+\.\d{2})/gm;

/**
 * Parses a Tally Credit Note or Debit Note page. Verified against a real
 * credit note (a pure commercial/price adjustment, no goods returned); a
 * debit note has never actually been seen, but Tally generates both from
 * the same voucher family, so this is applied to both under the working
 * assumption their layouts match -- flag it if a real debit note turns out
 * to look different.
 */
function parseAdjustmentPage(text: string, noteLabel: "Credit Note" | "Debit Note"): ParsedAdjustment | null {
  const noteMatch = text.match(new RegExp(`${noteLabel} No\\.\\s*\\n\\s*([^\\n]+)`));
  if (!noteMatch) return null;
  const noteNo = noteMatch[1].trim();

  const dateMatch = text.match(/\bDated\s*\n\s*(\d{1,2}-\w{3}-\d{2})\b/);
  const date = dateMatch ? toIsoDate(dateMatch[1]) : "";

  const relatedMatch = text.match(/Original Invoice No\.\s*&\s*Date\.\s*\n\s*([A-Z]{2,4}\/\d{2}-\d{2}\/\d+)/);
  const relatedInvoiceNo = relatedMatch ? relatedMatch[1] : null;

  let buyer: string | null = null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "Consignee (Ship to)") {
      buyer = lines[i + 1]?.trim() ?? null;
      break;
    }
  }

  const startMarkerMatch = text.match(/No\.\s*Rate/);
  if (!startMarkerMatch) return { noteNo, date, buyer, relatedInvoiceNo, particulars: [] };
  const fullBody = text.slice(startMarkerMatch.index! + startMarkerMatch[0].length);
  let endIdx = fullBody.length;
  for (const marker of ["SGST Output", "CGST Output", "IGST Output"]) {
    const i = fullBody.indexOf(marker);
    if (i !== -1 && i < endIdx) endIdx = i;
  }
  const body = fullBody.slice(0, endIdx);

  const particulars = [...body.matchAll(ADJUSTMENT_LINE_RE)].map((m) => ({
    description: m[2].replace(/\s+/g, " ").trim(),
    amount: parseFloat(m[3].replace(/,/g, "")),
  }));

  return { noteNo, date, buyer, relatedInvoiceNo, particulars };
}

export async function parseTallyInvoicePdf(buffer: Buffer): Promise<ParsePdfResult> {
  const { PDFParse } = await loadPdfParse();
  const parser = new PDFParse({ data: buffer });
  let text: { pages: { text: string }[] };
  try {
    text = await parser.getText();
  } finally {
    await parser.destroy();
  }

  const byInvoice = new Map<string, ParsedInvoice>();
  const byAdjustment = new Map<string, { kind: TallyDocumentType; parsed: ParsedAdjustment }>();
  for (const page of text.pages) {
    // Credit/debit notes are tried first -- both have their own distinct
    // "<Note type> No." marker, so this only routes a page there when that
    // marker is actually present, never mistakes a real invoice for one.
    const credit = parseAdjustmentPage(page.text, "Credit Note");
    const debit = credit ? null : parseAdjustmentPage(page.text, "Debit Note");
    const adjustment = credit ?? debit;
    if (adjustment) {
      const kind: TallyDocumentType = credit ? "credit_note" : "debit_note";
      const existing = byAdjustment.get(adjustment.noteNo);
      if (!existing) {
        byAdjustment.set(adjustment.noteNo, { kind, parsed: { ...adjustment, particulars: [...adjustment.particulars] } });
      } else {
        existing.parsed.particulars.push(...adjustment.particulars);
        if (!existing.parsed.buyer && adjustment.buyer) existing.parsed.buyer = adjustment.buyer;
      }
      continue;
    }

    const parsed = parsePage(page.text);
    if (!parsed) continue;
    const existing = byInvoice.get(parsed.invoiceNo);
    if (!existing) {
      byInvoice.set(parsed.invoiceNo, { ...parsed, items: [...parsed.items] });
    } else {
      existing.items.push(...parsed.items);
      if (parsed.printedTotal !== null) existing.printedTotal = parsed.printedTotal;
      if (!existing.buyer && parsed.buyer) existing.buyer = parsed.buyer;
    }
  }

  const warnings: string[] = [];
  const lines: ParsedInvoiceLine[] = [];

  for (const { kind, parsed } of byAdjustment.values()) {
    if (parsed.particulars.length === 0) {
      warnings.push(`${parsed.noteNo}: no adjustment lines found.`);
      continue;
    }
    // A credit note reduces revenue (negative), a debit note adds to it
    // (positive, same sign as a normal invoice) -- qty is fixed at 1 since
    // there's no physical unit on a ledger-level adjustment line, so the
    // signed rate alone carries the revenue impact when summed the same way
    // as every other tally_invoice_lines row (qty * rate).
    const sign = kind === "credit_note" ? -1 : 1;
    for (const p of parsed.particulars) {
      lines.push({
        invoiceNo: parsed.noteNo,
        date: parsed.date,
        buyerRaw: parsed.buyer ?? "",
        descriptionRaw: p.description,
        qty: 1,
        rate: sign * p.amount,
        batches: [],
        documentType: kind,
        relatedInvoiceNo: parsed.relatedInvoiceNo,
      });
    }
  }

  for (const inv of byInvoice.values()) {
    if (inv.items.length === 0) {
      warnings.push(`${inv.invoiceNo}: no line items found.`);
      continue;
    }
    const qtySum = inv.items.reduce((a, b) => a + b.qty, 0);
    if (inv.printedTotal !== null && Math.abs(qtySum - inv.printedTotal) > 0.01) {
      warnings.push(
        `${inv.invoiceNo}: parsed quantities sum to ${qtySum}, but the invoice's printed total is ${inv.printedTotal} -- double-check this invoice's lines.`
      );
    }
    for (const item of inv.items) {
      lines.push({
        invoiceNo: inv.invoiceNo,
        date: inv.date,
        buyerRaw: inv.buyer ?? "",
        descriptionRaw: item.description,
        qty: item.qty,
        rate: item.rate,
        documentType: "invoice",
        relatedInvoiceNo: null,
        batches: item.batches,
      });
    }
  }

  if (byInvoice.size === 0 && byAdjustment.size === 0) {
    warnings.push(
      "No invoices, credit notes, or debit notes recognized in this PDF -- it may not be an Arscent Tally export."
    );
  }

  return { lines, warnings };
}
