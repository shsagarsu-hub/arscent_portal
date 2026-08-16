import "server-only";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";

// PDFParse spawns a real Node worker_threads.Worker to do the actual
// parsing, defaulting to the relative path "./pdf.worker.mjs" -- which
// resolves fine locally but not against the file layout Vercel's serverless
// bundler produces, crashing the whole function before this module's own
// try/catch can run (bare 500, empty body -- confirmed live in production).
// require.resolve("pdf-parse") IS covered by the package's export map (its
// main entry), so it survives Vercel's bundler; walking up from it to the
// package root and back down to dist/worker/pdf.worker.mjs sidesteps both
// the relative-path issue and the export-map restriction on that subpath
// specifically (pdf-parse/dist/worker/... isn't itself exported).
//
// This has to run lazily, inside parseTallyInvoicePdf, NOT at module top
// level -- Next.js executes top-level module code again during its build-time
// "collect page data" step for every route, under Turbopack's own module
// system rather than real Node.js. Under that system require.resolve()
// returns Turbopack's internal numeric module id, not a filesystem path,
// which crashed the production build outright ("path" argument must be of
// type string, received type number). Deferring this until the function is
// actually called keeps it inside a genuine Node.js request at runtime.
let workerConfigured = false;
function ensurePdfWorkerConfigured() {
  if (workerConfigured) return;
  const require = createRequire(import.meta.url);
  const pdfParsePkgRoot = path.join(path.dirname(require.resolve("pdf-parse")), "..", "..", "..");
  PDFParse.setWorker(pathToFileURL(path.join(pdfParsePkgRoot, "dist", "worker", "pdf.worker.mjs")).href);
  workerConfigured = true;
}

// Ported from a Python/pdfplumber prototype and re-validated against this
// library's very different text layout (tab-delimited columns in a
// different order, vs. pdfplumber's flat left-to-right reading order) --
// every invoice this was built against was cross-checked by summing parsed
// line-item quantities against that invoice's own printed "Total N <unit>"
// line, so this isn't a guess at the format, it's fitted to real output.

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

export async function parseTallyInvoicePdf(buffer: Buffer): Promise<ParsePdfResult> {
  ensurePdfWorkerConfigured();
  const parser = new PDFParse({ data: buffer });
  let text: { pages: { text: string }[] };
  try {
    text = await parser.getText();
  } finally {
    await parser.destroy();
  }

  const byInvoice = new Map<string, ParsedInvoice>();
  for (const page of text.pages) {
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
        batches: item.batches,
      });
    }
  }

  if (byInvoice.size === 0) {
    warnings.push("No invoices recognized in this PDF -- it may not be an Arscent Tally sales invoice export.");
  }

  return { lines, warnings };
}
