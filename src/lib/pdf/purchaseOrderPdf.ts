import PDFDocument from "pdfkit";
import path from "node:path";
import { rupeesToWords } from "./numberToWords";

const ASSETS_DIR = path.join(process.cwd(), "src/lib/pdf/assets");
const LOGO_PATH = path.join(ASSETS_DIR, "arscent-logo.png");
const SIGNATURE_PATH = path.join(ASSETS_DIR, "authorized-signature.png");

export interface PurchaseOrderPdfLine {
  itemName: string;
  hsn: string | null;
  qty: number;
  unitPrice: number;
}

export interface PurchaseOrderPdfInput {
  poNumber: string;
  poDate: string; // ISO
  lines: PurchaseOrderPdfLine[];
  gstPercent: number;
  delivery: string;
  payment: string;
  warranty: string;
}

const PAGE_MARGIN = 50;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;
// ITEM / QTY / DESCRIPTION / HSN / UNIT PRICE / TOTAL PRICE -- same six
// columns, same relative proportions as the Excel template this replicates.
const COLS = { item: 30, qty: 40, desc: 225, hsn: 50, unitPrice: 75, total: 75.28 };

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/**
 * Renders the same fixed-layout document Arscent's own PO template
 * (`15 Zeiss PO.xlsx`) produces -- logo, To/PO No/PO Date header, an item
 * table, terms, a Sub Total/GST/Total block, amount in words, and a
 * Bill To + signed-and-stamped signatory block -- as a PDF attachment for
 * the Purchase tab's email. Built with pdfkit rather than a headless
 * browser: it's pure JS with no native/Chromium dependency, which matters
 * because this runs inside a Vercel serverless function, not a long-lived
 * server.
 */
export async function buildPurchaseOrderPdf(input: PurchaseOrderPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      render(doc, input);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    doc.end();
  });
}

function render(doc: PDFKit.PDFDocument, input: PurchaseOrderPdfInput) {
  const left = PAGE_MARGIN;
  const right = PAGE_MARGIN + CONTENT_WIDTH;

  doc.image(LOGO_PATH, left, PAGE_MARGIN, { width: 140 });

  doc.font("Helvetica-Bold").fontSize(16).text("PURCHASE ORDER", left, PAGE_MARGIN + 40, {
    width: CONTENT_WIDTH,
    align: "center",
  });

  let y = PAGE_MARGIN + 75;
  doc.font("Helvetica").fontSize(11);
  doc.text("To,", left, y);
  doc.text("Carl Zeiss India (Bangalore) Pvt. Ltd.", left, y + 15);
  doc.text("ZEISS Group", left, y + 30);
  doc.text("Plot No. 3, Jigani Link Road, Bommasandra Industrial Area", left, y + 45);
  doc.text("Bangalore – 560099, India", left, y + 60);

  const poBoxX = right - 190;
  const poBoxW = 190;
  drawLabeledBox(doc, poBoxX, y, poBoxW, "PO No", input.poNumber);
  drawLabeledBox(doc, poBoxX, y + 22, poBoxW, "PO Date", new Date(input.poDate).toLocaleDateString("en-IN"));

  y += 95;

  // ---- Item table ----
  const colX = {
    item: left,
    qty: left + COLS.item,
    desc: left + COLS.item + COLS.qty,
    hsn: left + COLS.item + COLS.qty + COLS.desc,
    unitPrice: left + COLS.item + COLS.qty + COLS.desc + COLS.hsn,
    total: left + COLS.item + COLS.qty + COLS.desc + COLS.hsn + COLS.unitPrice,
  };
  // 34pt, not 24 -- "UNIT PRICE IN Rs." / "TOTAL PRICE IN Rs." each wrap to
  // two lines at this column width, and a too-short row let the second line
  // spill into the row below.
  const headerH = 34;
  doc.rect(left, y, CONTENT_WIDTH, headerH).fillAndStroke("#e8ecf5", "#9aa5b8");
  doc.fillColor("#172544").font("Helvetica-Bold").fontSize(8.5);
  const headerY = y + 6;
  doc.text("ITEM", colX.item, headerY + 4, { width: COLS.item, align: "center" });
  doc.text("QTY", colX.qty, headerY + 4, { width: COLS.qty, align: "center" });
  doc.text("DESCRIPTION", colX.desc, headerY + 4, { width: COLS.desc, align: "center" });
  doc.text("HSN", colX.hsn, headerY + 4, { width: COLS.hsn, align: "center" });
  doc.text("UNIT PRICE IN Rs.", colX.unitPrice, headerY, { width: COLS.unitPrice, align: "center" });
  doc.text("TOTAL PRICE IN Rs.", colX.total, headerY, { width: COLS.total, align: "center" });
  y += headerH;

  doc.font("Helvetica").fontSize(10).fillColor("#172544");
  let subTotal = 0;
  input.lines.forEach((l, i) => {
    const lineTotal = l.qty * l.unitPrice;
    subTotal += lineTotal;
    const descHeight = doc.heightOfString(l.itemName, { width: COLS.desc - 8 });
    const rowH = Math.max(22, descHeight + 8);
    doc.rect(left, y, CONTENT_WIDTH, rowH).stroke("#c7cfdd");
    const textY = y + rowH / 2 - 5;
    doc.text(String(i + 1), colX.item, textY, { width: COLS.item, align: "center" });
    doc.text(String(l.qty), colX.qty, textY, { width: COLS.qty, align: "center" });
    doc.text(l.itemName, colX.desc + 4, y + 5, { width: COLS.desc - 8 });
    doc.text(l.hsn ?? "", colX.hsn, textY, { width: COLS.hsn, align: "center" });
    doc.text(fmt(l.unitPrice), colX.unitPrice, textY, { width: COLS.unitPrice - 6, align: "right" });
    doc.text(fmt(lineTotal), colX.total, textY, { width: COLS.total - 8, align: "right" });
    y += rowH;
  });

  y += 20;

  // ---- Terms & Conditions ----
  doc.font("Helvetica-Bold").fontSize(11).text("Terms & Conditions", left, y, { width: CONTENT_WIDTH, align: "center" });
  y += 16;
  doc.font("Helvetica").fontSize(10);
  [`Delivery : ${input.delivery}`, `Payment : ${input.payment}`, `Warranty : ${input.warranty}`].forEach((line) => {
    doc.text(line, left, y, { width: CONTENT_WIDTH, align: "center" });
    y += 14;
  });

  y += 12;

  // ---- Sub Total / GST / Total ----
  const gstAmount = subTotal * (input.gstPercent / 100);
  // Rounded to the nearest rupee -- matches the source template, whose Total
  // cell (and the amount-in-words below it) drop the paise even though the
  // GST line above shows them.
  const total = Math.round(subTotal + gstAmount);
  const summaryW = 220;
  const summaryX = right - summaryW;
  const summaryRows: [string, string][] = [
    ["Sub Total", fmt(subTotal)],
    [`GST @ ${input.gstPercent}%`, fmt(gstAmount)],
    ["Total", fmt(total)],
  ];
  summaryRows.forEach(([label, value], i) => {
    const rowH = 20;
    const isTotal = i === summaryRows.length - 1;
    doc.rect(summaryX, y, summaryW, rowH).stroke("#c7cfdd");
    doc.font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(10.5);
    doc.text(label, summaryX + 8, y + 5, { width: summaryW * 0.5 });
    doc.text(`Rs. ${value}`, summaryX + summaryW * 0.5, y + 5, { width: summaryW * 0.5 - 8, align: "right" });
    y += rowH;
  });

  y += 16;
  doc.font("Helvetica-Bold").fontSize(10).text(rupeesToWords(total), left, y, { width: CONTENT_WIDTH });

  y += 34;

  // ---- Bill To / Signatory ----
  const billToY = y;
  doc.font("Helvetica-Bold").fontSize(10.5).text("Bill To:", left, billToY);
  doc.font("Helvetica").fontSize(10);
  [
    "Arscent Health Services Pvt Ltd",
    "#110, 2nd Cross, 4th main,",
    "HAL 3rd Stage, Bangalore - 560075,",
    "GSTIN: 29AAKCA0923F1ZU",
    "Email: sales.arscent@gmail.com, PH: 080-40950869",
    "DL: 20B-KA-B51-205328 & 21B-KA-B51-205329",
  ].forEach((line, i) => {
    doc.text(line, left, billToY + 15 + i * 13, { width: 290 });
  });

  const sigX = right - 170;
  doc.font("Helvetica-Bold").fontSize(10).text("For Arscent Health Services Pvt Ltd", sigX, billToY, { width: 170, align: "center" });
  doc.image(SIGNATURE_PATH, sigX + 40, billToY + 14, { width: 90 });
  doc.font("Helvetica-Bold").fontSize(9.5).text("Authorised Signatory", sigX, billToY + 92, { width: 170, align: "center" });
  doc.font("Helvetica").fontSize(9.5).text("Bhuvana M", sigX, billToY + 105, { width: 170, align: "center" });
  doc.text("Mob: 9663859680", sigX, billToY + 118, { width: 170, align: "center" });

  const footerY = billToY + 145;
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#6b7c9e")
    .text("Note: If you have any question about this Purchase Order, Please Contact", left, footerY, {
      width: CONTENT_WIDTH,
    });
}

function drawLabeledBox(doc: PDFKit.PDFDocument, x: number, y: number, w: number, label: string, value: string) {
  const labelW = w * 0.4;
  doc.rect(x, y, labelW, 20).stroke("#9aa5b8");
  doc.rect(x + labelW, y, w - labelW, 20).stroke("#9aa5b8");
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#172544").text(label, x + 6, y + 5, { width: labelW - 10 });
  doc.font("Helvetica").fontSize(9.5).text(value, x + labelW + 6, y + 5, { width: w - labelW - 12 });
}
