const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return TENS[tens] + (ones ? ` ${ONES[ones]}` : "");
}

function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return twoDigits(rest);
  return `${ONES[hundreds]} Hundred${rest ? ` and ${twoDigits(rest)}` : ""}`;
}

/**
 * Indian numbering (crore/lakh/thousand, not the Western million/billion
 * grouping), matching the wording style Arscent's own PO template already
 * uses -- "Rupees: Thirty Three Thousand Four Hundred and Seventy Five
 * Only." Rounds to the nearest rupee; a PO's GST-inclusive total is
 * effectively never a fractional amount worth spelling out in paise.
 */
export function rupeesToWords(amount: number): string {
  let n = Math.round(amount);
  if (n === 0) return "Rupees: Zero Only.";

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  return `Rupees: ${parts.join(" ")} Only.`;
}
