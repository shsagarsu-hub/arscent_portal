// Best-effort suggestions only — never auto-commit a match. Every suggestion
// here is meant to pre-fill a dropdown a human still has to confirm, because
// invoice item descriptions carry patient-specific power/cylinder values
// Tally has no reason to strip (e.g. "AT TORBI 719M SE+18.00 CYL01.5" for a
// SKU catalogued as "AT TORBI 709M" — a real model-number mismatch found in
// the first sample invoice, not a hypothetical).

function normalizeWords(s: string): string[] {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9. ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Strips the patient-specific power/cylinder tail so the base product code is left. */
export function stripPowerSpecs(description: string): string {
  const cut = description.search(/\b(SE\+|SE-|CYL|DPT|TIP\d)/);
  return (cut === -1 ? description : description.slice(0, cut)).trim();
}

export interface AccountMatch {
  accountId: string | null;
  label: string | null;
  confidence: "high" | "low" | "none";
}

export function matchAccount(
  buyerRaw: string,
  accounts: { id: string; label: string }[]
): AccountMatch {
  const buyerWords = new Set(normalizeWords(buyerRaw));
  let best: { id: string; label: string; score: number } | null = null;

  for (const a of accounts) {
    const labelWords = normalizeWords(a.label).filter((w) => w.length > 2 && w !== "THE");
    const overlap = labelWords.filter((w) => buyerWords.has(w)).length;
    const score = labelWords.length ? overlap / labelWords.length : 0;
    if (!best || score > best.score) best = { id: a.id, label: a.label, score };
  }

  if (!best || best.score === 0) return { accountId: null, label: null, confidence: "none" };
  return {
    accountId: best.id,
    label: best.label,
    confidence: best.score >= 0.5 ? "high" : "low",
  };
}

export interface SkuMatch {
  skuId: string | null;
  name: string | null;
  confidence: "high" | "low" | "none";
  crossAccount: boolean;
}

export function matchSku(
  descriptionRaw: string,
  matchedAccountId: string | null,
  skus: { id: string; name: string; account_id: string }[]
): SkuMatch {
  const base = stripPowerSpecs(descriptionRaw);
  const baseWords = new Set(normalizeWords(base));

  let best: { id: string; name: string; account_id: string; score: number } | null = null;
  for (const s of skus) {
    const skuWords = normalizeWords(s.name).filter((w) => w.length > 1);
    const overlap = skuWords.filter((w) => baseWords.has(w)).length;
    const score = skuWords.length ? overlap / skuWords.length : 0;
    // Small bonus for matching within the already-matched account, so a tie
    // prefers the right account's SKU over an identically-named one elsewhere.
    const adjusted = score + (s.account_id === matchedAccountId ? 0.05 : 0);
    if (!best || adjusted > best.score) best = { ...s, score: adjusted };
  }

  if (!best || best.score < 0.3) return { skuId: null, name: null, confidence: "none", crossAccount: false };
  return {
    skuId: best.id,
    name: best.name,
    confidence: best.score >= 0.7 ? "high" : "low",
    crossAccount: matchedAccountId !== null && best.account_id !== matchedAccountId,
  };
}

export interface CatalogItemMatch {
  itemId: string | null;
  name: string | null;
  confidence: "high" | "low" | "none";
}

/** Picks the best item_master candidate for an invoice line. Unlike
 * matchSku, this scores against the FULL raw description (power/cylinder
 * spec included) rather than the stripped base — the candidate pool here is
 * a specific power/diopter variant search, so the spec is exactly what
 * distinguishes the right row from its neighbors (e.g. "DPT 19.5" vs
 * "DPT 18.0"), not noise to discard. */
export function matchCatalogItem(
  descriptionRaw: string,
  candidates: { id: string; name: string }[]
): CatalogItemMatch {
  const descWords = new Set(normalizeWords(descriptionRaw));

  let best: { id: string; name: string; score: number } | null = null;
  for (const c of candidates) {
    const itemWords = normalizeWords(c.name);
    const overlap = itemWords.filter((w) => descWords.has(w)).length;
    const score = itemWords.length ? overlap / itemWords.length : 0;
    if (!best || score > best.score) best = { ...c, score };
  }

  if (!best || best.score < 0.5) return { itemId: null, name: null, confidence: "none" };
  return { itemId: best.id, name: best.name, confidence: best.score >= 0.8 ? "high" : "low" };
}
