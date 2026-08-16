// Extracted from RRNAGAR.pdf (23 invoices, AR/26-27/1276-1435, all to NN1 —
// Narayana Nethralaya, Rajajinagar). Every invoice's parsed line-item qty sum
// was cross-checked against that invoice's own printed "Total N <unit>"
// line — all 17 invoices (some line items repeat the same invoice number
// across their qty) matched exactly. A handful of descriptions that PDF
// line-wrapping split across the numeric columns (e.g. "Treatment Pack M ("
// with "Pack of 10)" landing after the Amount column in extraction order)
// were manually restored from the source text rather than left truncated.
export interface TallySampleLine {
  invoiceNo: string;
  date: string;
  buyerRaw: string;
  descriptionRaw: string;
  qty: number;
  rate: number;
}

export const tallySampleLines: TallySampleLine[] = [
  { invoiceNo: "AR/26-27/1276", date: "2026-07-31", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT TORBI 719M SE+18.00 CYL01.5", qty: 1, rate: 18095.23 },
  { invoiceNo: "AR/26-27/1277", date: "2026-07-31", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT LISA TRI TORIC 949MP SE+23.", qty: 1, rate: 70476.20 },
  { invoiceNo: "AR/26-27/1278", date: "2026-07-31", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT ELANA 841P TIP2.2 DPT 24.0", qty: 1, rate: 65714.28 },
  { invoiceNo: "AR/26-27/1298", date: "2026-08-01", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT ELANA 841P TIP2.2 DPT 21.5", qty: 1, rate: 65714.28 },
  { invoiceNo: "AR/26-27/1298", date: "2026-08-01", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT ELANA 841P TIP2.2 DPT 25.5", qty: 1, rate: 65714.28 },
  { invoiceNo: "AR/26-27/1298", date: "2026-08-01", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT ELANA 841P TIP2.2 DPT 20.5", qty: 1, rate: 65714.28 },
  { invoiceNo: "AR/26-27/1299", date: "2026-08-01", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT ELANA 841P TIP2.2 DPT 25.5", qty: 1, rate: 65714.28 },
  { invoiceNo: "AR/26-27/1299", date: "2026-08-01", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT ELANA 841P TIP2.2 DPT 23.0", qty: 1, rate: 65714.28 },
  { invoiceNo: "AR/26-27/1297", date: "2026-08-01", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS .AT LISA 809M DPT 23.5", qty: 1, rate: 41904.76 },
  { invoiceNo: "AR/26-27/1300", date: "2026-08-01", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT LISA TRI TORIC 949MP SE+19.", qty: 1, rate: 70476.20 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 15.0", qty: 1, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 16.0", qty: 2, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 18.0", qty: 6, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 18.5", qty: 3, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 19.0", qty: 5, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 19.5", qty: 5, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 20.5", qty: 5, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 21.0", qty: 9, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 21.5", qty: 8, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 22.0", qty: 13, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 22.5", qty: 13, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 23.5", qty: 2, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 24.0", qty: 2, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.4 DPT 24.5", qty: 5, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.4 DPT 25.0", qty: 12, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.4 DPT 25.5", qty: 5, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1305", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.4 DPT 28.0", qty: 1, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 11.5", qty: 1, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 12.0", qty: 1, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 13.0", qty: 2, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 13.5", qty: 1, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 14.0", qty: 1, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 15.0", qty: 2, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 18.0", qty: 7, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 18.5", qty: 8, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 19.0", qty: 10, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 19.5", qty: 13, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 20.0", qty: 5, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 20.5", qty: 10, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 21.0", qty: 9, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 21.5", qty: 15, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 22.0", qty: 15, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 22.5", qty: 18, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 23.0", qty: 5, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 23.5", qty: 5, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 24.0", qty: 5, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.4 DPT 24.5", qty: 2, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.4 DPT 25.0", qty: 8, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.4 DPT 25.5", qty: 5, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1314", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.4 DPT 30.0", qty: 1, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1315", date: "2026-08-03", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT ELANA 841P TIP2.2 DPT 24.0", qty: 1, rate: 65714.28 },
  { invoiceNo: "AR/26-27/1357", date: "2026-08-05", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT TORBI 719M SE+21.50 CYL02.0", qty: 1, rate: 18095.23 },
  { invoiceNo: "AR/26-27/1359", date: "2026-08-05", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "Treatment Licence Flap (10 Proceedure)", qty: 10, rate: 0 },
  { invoiceNo: "AR/26-27/1359", date: "2026-08-05", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "Treatment Pack M (Pack of 10)", qty: 7, rate: 104761.90 },
  { invoiceNo: "AR/26-27/1359", date: "2026-08-05", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "treatment Pack S (Pack of 10)", qty: 3, rate: 104761.90 },
  { invoiceNo: "AR/26-27/1360", date: "2026-08-05", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "Treatment Licence Smile Pro (10 Procedure)", qty: 5, rate: 281247.60 },
  { invoiceNo: "AR/26-27/1360", date: "2026-08-05", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "Treatment Pack M (Pack of 10)", qty: 5, rate: 0 },
  { invoiceNo: "AR/26-27/1369", date: "2026-08-06", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT LISA TRI TORIC 949MP SE+23.", qty: 1, rate: 70476.19 },
  { invoiceNo: "AR/26-27/1406", date: "2026-08-08", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT LISA TRI 839MP DPT 19.0", qty: 1, rate: 60952.38 },
  { invoiceNo: "AR/26-27/1417", date: "2026-08-10", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS AT LISA TRI TORIC 949MP SE+21.", qty: 1, rate: 70476.19 },
  { invoiceNo: "AR/26-27/1435", date: "2026-08-11", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 15.5", qty: 1, rate: 8571.43 },
  { invoiceNo: "AR/26-27/1435", date: "2026-08-11", buyerRaw: "Narayana Nethralaya -Rajaji Nagar", descriptionRaw: "ZEISS CT LUCIA 621P TIP2.2 DPT 24.0", qty: 3, rate: 8571.43 },
];
