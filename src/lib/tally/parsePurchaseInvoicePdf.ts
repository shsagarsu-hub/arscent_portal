import "server-only";
import { loadPdfParse } from "./parsePdf";

// Built and validated against a real Zeiss purchase tax invoice
// (DO2926007687, 432 line items). Every real invoice PDF Zeiss sends bundles
// 3 identical copies back to back ("Original for Recipient" / "Duplicate for
// Transporter" / "Triplicate for Supplier"), each restarting its own page
// counter at "Page: 1 / N" -- only the first copy is parsed; the other two
// would otherwise double/triple every line item.

export interface ParsedPurchaseInvoiceLine {
  itemNo: string;
  productId: string;
  description: string;
  qty: number;
  unitPrice: number;
  countryOfOrigin: string | null;
  serials: string[];
  batch: string | null;
  expiryDate: string | null; // ISO
  hsnCode: string | null;
}

export interface ParsedPurchaseInvoice {
  invoiceNo: string;
  invoiceDate: string | null; // ISO
  lines: ParsedPurchaseInvoiceLine[];
  warnings: string[];
}

function toIsoDateDots(raw: string): string | null {
  const m = raw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo}-${d}`;
}

// A serial's numeric tail increments across a range ("6S2605200042 -
// 6S2605200044" -> ...042, ...043, ...044) while its prefix (letters +
// leading digits) stays fixed -- found by diffing the two endpoints from the
// right, not by guessing a fixed serial format, since the alphanumeric
// prefix length varies (confirmed: "3S..." and "6S..." serials both occur,
// always the same length as each other within one range).
function expandSerialRange(start: string, end: string): string[] {
  if (start.length !== end.length) return [start, end];
  let split = start.length;
  while (split > 0 && start[split - 1] !== end[split - 1]) split--;
  const prefix = start.slice(0, split);
  const startNum = start.slice(split);
  const endNum = end.slice(split);
  if (!/^\d+$/.test(startNum) || !/^\d+$/.test(endNum)) return [start, end];
  const width = startNum.length;
  const from = parseInt(startNum, 10);
  const to = parseInt(endNum, 10);
  if (to < from || to - from > 500) return [start, end]; // sanity cap against a bad diff
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(prefix + String(n).padStart(width, "0"));
  return out;
}

function parseSerialList(raw: string): string[] {
  const tokens = raw
    .split(",")
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const t of tokens) {
    const rangeMatch = t.match(/^(\S+)\s*-\s*(\S+)$/);
    if (rangeMatch) {
      out.push(...expandSerialRange(rangeMatch[1], rangeMatch[2]));
    } else {
      out.push(t);
    }
  }
  return out;
}

// Item header: "<Sl No>\t<Product ID>\t<Qty> PC\t<Item Price>\t<Total Price>"
// -- tab-delimited and numeric-anchored the same way parsePdf.ts anchors on
// Tally's Sl No. column, for the same reason: it needs no per-product-name
// maintenance as Zeiss's catalog changes.
// Fields are tab-separated, but pdf-parse's extraction leaves a stray space
// before each tab ("10 \t003500-..." not "10\t003500-..."), confirmed
// against this invoice's actual bytes -- `[ \t]+` tolerates that instead of
// requiring a literal `\t` right after each field.
const ITEM_HEADER_RE = /^(\d{1,3})[ \t]+(\d{6}-\d{4}-\d{3})[ \t]+(\d+(?:\.\d+)?)\s*PC[ \t]+([\d,]+\.\d{2})[ \t]+([\d,]+\.\d{2})\s*$/gm;

export async function parsePurchaseInvoicePdf(buffer: Buffer): Promise<ParsedPurchaseInvoice> {
  const { PDFParse } = await loadPdfParse();
  const parser = new PDFParse({ data: buffer });
  let pages: { text: string }[];
  try {
    pages = (await parser.getText()).pages;
  } finally {
    await parser.destroy();
  }

  const warnings: string[] = [];

  // Isolate the first copy only -- every page whose "Page: N / M" counter
  // restarts at 1 marks the start of another identical copy.
  const copyStarts = pages
    .map((p, i) => ({ i, isStart: /Page:\s*\t?\s*1\s*\/\s*\d+/.test(p.text) }))
    .filter((p) => p.isStart)
    .map((p) => p.i);
  const firstCopyEnd = copyStarts.length > 1 ? copyStarts[1] : pages.length;
  const firstCopyPages = pages.slice(copyStarts[0] ?? 0, firstCopyEnd);
  if (copyStarts.length > 1) {
    warnings.push(`This PDF bundles ${copyStarts.length} copies of the same invoice -- only the first was read.`);
  }

  // Every page after the first repeats this same running header before its
  // own content. When a field like Serial Number wraps across a page break
  // (confirmed on a real invoice -- a 6-serial list split 3+3 across pages
  // 14/15), that header lands INSIDE the field's text, not between fields,
  // so it has to be stripped before concatenating, not just skipped at each
  // page's start.
  const PAGE_HEADER_RE =
    /Document Number:\s*\t?\s*\S+\s*\nDate:\s*\t?\s*[\d.]+\s*\nPage:\s*\t?\s*\d+\s*\/\s*\d+\s*\n(?:Item\s*\t?Product ID \/\s*\nProduct Description\s*\nQuantity\s*\t?Item Price\s*\n\(INR\)\s*\nTotal Price\s*\n\(INR\)\s*\n?)?/g;

  const fullText = firstCopyPages
    .map((p) => p.text)
    .join("\n")
    .replace(PAGE_HEADER_RE, "");

  const invMatch = fullText.match(/Tax Invoice No \/ Date:\s*\t?\s*(\S+)\s*\/\s*(\d{2}\.\d{2}\.\d{4})/);
  const invoiceNo = invMatch?.[1] ?? "UNKNOWN";
  const invoiceDate = invMatch ? toIsoDateDots(invMatch[2]) : null;
  if (!invMatch) warnings.push("Could not find the invoice number/date -- this may not be a Zeiss tax invoice.");

  const headerMatches = [...fullText.matchAll(ITEM_HEADER_RE)];
  const lines: ParsedPurchaseInvoiceLine[] = [];

  for (let i = 0; i < headerMatches.length; i++) {
    const m = headerMatches[i];
    const chunkStart = m.index! + m[0].length;
    const chunkEnd = i + 1 < headerMatches.length ? headerMatches[i + 1].index! : fullText.indexOf("Sub Total", chunkStart);
    const chunk = fullText.slice(chunkStart, chunkEnd === -1 ? fullText.length : chunkEnd);

    const [, itemNo, productId, qtyRaw, unitPriceRaw] = m;
    const qty = parseFloat(qtyRaw);
    const unitPrice = parseFloat(unitPriceRaw.replace(/,/g, ""));

    const description = chunk.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";

    const countryMatch = chunk.match(/Country of Origin:\s*\t?\s*(\S+)/);
    const serialMatch = chunk.match(/Serial Number:\s*\t?\s*\(([\s\S]*?)\)/);
    const batchMatch = chunk.match(/Batch:\s*\t?\s*(\S+)/);
    const expiryMatch = chunk.match(/SLED\/BBD:\s*\t?\s*(\d{2}\.\d{2}\.\d{4})/);
    const hsnMatch = chunk.match(/HSN\/SAC Code:\s*\t?\s*(\S+)/);

    const serials = serialMatch ? parseSerialList(serialMatch[1].replace(/\n/g, " ")) : [];
    if (serials.length !== qty) {
      warnings.push(
        `Item ${itemNo} (${description}): ${serials.length} serial(s) parsed but quantity is ${qty} -- double-check this line.`
      );
    }

    lines.push({
      itemNo,
      productId,
      description,
      qty,
      unitPrice,
      countryOfOrigin: countryMatch?.[1] ?? null,
      serials,
      batch: batchMatch?.[1] ?? null,
      expiryDate: expiryMatch ? toIsoDateDots(expiryMatch[1]) : null,
      hsnCode: hsnMatch?.[1] ?? null,
    });
  }

  if (lines.length === 0) {
    warnings.push("No line items recognized in this PDF -- it may not be a Zeiss purchase invoice.");
  }

  return { invoiceNo, invoiceDate, lines, warnings };
}
