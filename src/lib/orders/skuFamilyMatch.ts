import "server-only";

/**
 * Maps a granular official item_master name (e.g. "ZEISS CT LUCIA 621P
 * TIP2.2 DPT 20.5") back to the generic commitment-tracking family it
 * belongs to in `skus` (e.g. "CT LUCIA") -- skus is Tally-sourced and only
 * tracks families, never specific diopters, and stays that way on purpose
 * (Vs Committed / Account Manager must not change). This is purely how the
 * hospital order flow resolves which sku_id a granular pick counts against.
 *
 * Matched on family keywords, not exact model numbers -- item_master and
 * skus disagree on at least one model number today (skus has "AT TORBI
 * 709M", the real inventory model is "719M"), so exact-prefix matching
 * would silently drop that family. Order matters: more specific patterns
 * (e.g. "TRI TORIC") must be checked before their broader parents ("TRI").
 */
const FAMILY_MATCHERS: { test: (upperName: string) => boolean; skuNames: string[] }[] = [
  { test: (n) => n.includes("AT LISA") && n.includes("TRI") && n.includes("TORIC"), skuNames: ["AT LISA Tri Toric 939MP"] },
  { test: (n) => n.includes("AT LISA") && n.includes("TRI") && n.includes("839"), skuNames: ["AT LISA 839MP (Trifocal)"] },
  { test: (n) => n.includes("AT LISA") && n.includes("809"), skuNames: ["AT LISA 809M"] },
  { test: (n) => n.includes("AT ELANA"), skuNames: ["AT ELANA"] },
  { test: (n) => n.includes("AT TORBI"), skuNames: ["AT TORBI 709M"] },
  { test: (n) => n.includes("AT LARA") && n.includes("TORIC"), skuNames: ["AT LARA Toric 929MP", "AT LARA toric 929MP"] },
  { test: (n) => n.includes("AT LARA"), skuNames: ["AT LARA 829MP"] },
  { test: (n) => n.includes("CT ASPHINA") && n.includes("509"), skuNames: ["CT ASPHINA 509"] },
  { test: (n) => n.includes("CT ASPHINA") && n.includes("404"), skuNames: ["CT ASPHINA 404"] },
  { test: (n) => n.includes("CT ASPHINA"), skuNames: ["CT ASPHINA 409"] },
  { test: (n) => n.includes("CT SPHERIS") && n.includes("209"), skuNames: ["CT SPHERIS 209M"] },
  { test: (n) => n.includes("CT SPHERIS"), skuNames: ["CT SPHERIS 204"] },
  { test: (n) => n.includes("CT LUCIA"), skuNames: ["CT LUCIA"] },
  { test: (n) => n.includes("SMILE") && n.includes("PACK"), skuNames: ["SMILE Pro Pack (Lenticule)"] },
  { test: (n) => n.includes("SMILE"), skuNames: ["SMILE (Treatment)", "SMILE Pro Pack (Lenticule)"] },
  { test: (n) => n.includes("FLAP"), skuNames: ["FLAP"] },
  { test: (n) => n.includes("ICR"), skuNames: ["ICR Licence"] },
  { test: (n) => n.includes("KERATOPLASTY"), skuNames: ["Keratoplasty Licence"] },
  // Pack-of-10 variant must be checked before the bare "CIRCLE" rule below --
  // same reasoning as TRI TORIC before TRI: the more specific product name
  // has to win, or every "CIRCLE" item_master row (including this one) would
  // resolve to the older, unpriced single-unit sku instead.
  { test: (n) => n.includes("CIRCLE") && n.includes("PACK OF 10"), skuNames: ["Circle (Retreatment License) - Pack of 10"] },
  { test: (n) => n.includes("CIRCLE"), skuNames: ["Circle (Retreatment)"] },
];

export interface SkuLite {
  id: string;
  name: string;
}

/** Returns the account's own sku row this item_master name counts against, or null if this hospital doesn't have that family on its account at all. */
export function matchSkuFamily(itemMasterName: string, accountSkus: SkuLite[]): SkuLite | null {
  const upper = itemMasterName.toUpperCase();
  const byName = new Map(accountSkus.map((s) => [s.name, s]));
  for (const rule of FAMILY_MATCHERS) {
    if (!rule.test(upper)) continue;
    for (const candidate of rule.skuNames) {
      const hit = byName.get(candidate);
      if (hit) return hit;
    }
  }
  return null;
}

/** Every keyword pattern this hospital's own sku list resolves to -- used to scope an item_master search/template to only families they actually have an account for. */
export function familyPatternsFor(accountSkus: SkuLite[]): ((upperName: string) => boolean)[] {
  const names = new Set(accountSkus.map((s) => s.name));
  return FAMILY_MATCHERS.filter((rule) => rule.skuNames.some((n) => names.has(n))).map((rule) => rule.test);
}
