/**
 * Minimal GS1 element-string parser for what's actually printed on Zeiss IOL
 * UDI labels: (01) GTIN, (11) production date, (17) expiry date, (21) serial
 * number -- e.g. "(01)04049336002360(11)250611(17)280531(21)6S2510030077".
 * Handles both the human-readable parenthesized form and the raw
 * concatenated form a DataMatrix decode can return (fixed-length AIs need no
 * separator; the GS1 group separator \x1D, when present, ends a
 * variable-length field like the serial).
 */

export interface Gs1Fields {
  gtin: string | null;
  productionDate: string | null; // YYMMDD as printed
  expiryDate: string | null; // YYMMDD as printed
  serial: string | null;
}

// AI -> fixed data length, when the AI is fixed-length. Variable-length AIs
// (21 among them) are terminated by the GS1 group separator or end of string.
const FIXED_LENGTH: Record<string, number> = {
  "00": 18,
  "01": 14,
  "11": 6,
  "17": 6,
};

const GS = "";

export function parseGs1(raw: string): Gs1Fields {
  const fields: Gs1Fields = { gtin: null, productionDate: null, expiryDate: null, serial: null };
  if (!raw) return fields;

  // Strip a leading symbology identifier some readers prepend (e.g. "]d2"),
  // and/or a leading FNC1 -- ZXing's DataMatrixReader represents it as a
  // literal GS (0x1D) character right before the first AI, confirmed
  // against a real decode (raw started with charCode 29, then "01..."). Left
  // in place, every AI/value boundary after it reads one character short.
  let s = raw.replace(/^\][A-Za-z]\d/, "").replace(new RegExp(`^${GS}`), "");

  // Parenthesized human-readable form.
  if (s.includes("(")) {
    const re = /\((\d{2,4})\)([^(]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      applyAi(fields, m[1], m[2].trim());
    }
    return fields;
  }

  // Raw concatenated element string.
  let i = 0;
  while (i < s.length) {
    const ai = s.slice(i, i + 2);
    i += 2;
    const fixedLen = FIXED_LENGTH[ai];
    let value: string;
    if (fixedLen) {
      value = s.slice(i, i + fixedLen);
      i += fixedLen;
    } else {
      const gsIdx = s.indexOf(GS, i);
      value = gsIdx === -1 ? s.slice(i) : s.slice(i, gsIdx);
      i = gsIdx === -1 ? s.length : gsIdx + 1;
    }
    applyAi(fields, ai, value);
  }
  return fields;
}

function applyAi(fields: Gs1Fields, ai: string, value: string) {
  if (ai === "01") fields.gtin = value;
  else if (ai === "11") fields.productionDate = value;
  else if (ai === "17") fields.expiryDate = value;
  else if (ai === "21") fields.serial = value;
}
