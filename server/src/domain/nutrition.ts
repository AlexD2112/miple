/**
 * Maps a raw receipt line (e.g. "BNLS CHKN BRST 1.52LB 7.58") to a row of fixtures/nutrition.json
 * (USDA FoodData Central macros per 100 g + typical package size).
 *
 * Pipeline: normalize -> exact alias lookup -> token/fuzzy fallback with a confidence score.
 * Pure and synchronous; the fixture is loaded lazily once. Not wired into any route yet.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CATEGORIES, ItemNutrition } from "./schemas.js";

type Category = (typeof CATEGORIES)[number];

export interface NutritionRow {
  item_name: string;
  aliases: string[];
  fdc_id: number;
  fdc_description: string;
  data_type: "foundation" | "sr_legacy";
  category: Category;
  calories_kcal_100g: number | null;
  protein_g_100g: number | null;
  carbs_g_100g: number | null;
  fat_g_100g: number | null;
  fiber_g_100g: number | null;
  typical_package_size_g: number;
  typical_package_desc: string;
  energy_source_nutrient: string | null;
  fiber_source: string | null;
}

export interface NutritionMatch {
  row: NutritionRow;
  /** The alias / item name that matched, in normalized form. */
  matched: string;
  method: "exact" | "fuzzy";
  /** 1 for exact; 0..1 for fuzzy. Below NUTRITION_REVIEW_THRESHOLD, ask the user. */
  confidence: number;
  normalized: string;
}

/** Matches below this confidence are returned with `needs_review: true` (ask the user to confirm). */
export const NUTRITION_REVIEW_THRESHOLD = 0.7;

const FIXTURE = fileURLToPath(new URL("../../../fixtures/nutrition.json", import.meta.url));

/** Lines that are never food. Checked on the lowercased raw line. */
const NON_FOOD =
  /\b(sales tax|tax|bag fee|bag charge|paper bag|bottle deposit|deposit|crv|coupon|discount|savings|you saved|subtotal|sub total|total|balance|change due|cash|visa|mastercard|amex|debit|credit|loyalty|reward)\b/;

/** Receipt abbreviations -> words used in nutrition aliases. */
const ABBREV: Record<string, string> = {
  bnls: "boneless", bnl: "boneless", sknls: "skinless", skls: "skinless", chkn: "chicken", chk: "chicken",
  ckn: "chicken", chick: "chicken", brst: "breast", bst: "breast", thgh: "thigh", thg: "thigh", drmstk: "drumstick",
  grnd: "ground", grd: "ground", bf: "beef", trky: "turkey", tky: "turkey", prk: "pork", sau: "sausage",
  saus: "sausage", bcn: "bacon", slmn: "salmon", shrmp: "shrimp", atl: "atlantic",
  spnch: "spinach", spin: "spinach", brocc: "broccoli", broc: "broccoli", tom: "tomato", toms: "tomato", pot: "potato",
  pots: "potato", potat: "potato", onn: "onion", onio: "onion", ylw: "yellow", yel: "yellow", grn: "green",
  wht: "white", blk: "black", swt: "sweet", avoc: "avocado", avo: "avocado", bnna: "banana", ban: "banana",
  strwb: "strawberry", strw: "strawberry", rasp: "raspberry", bluebry: "blueberry", appl: "apple", lttc: "lettuce",
  lett: "lettuce", rom: "romaine", cuke: "cucumber", cucmbr: "cucumber", mush: "mushroom", mshrm: "mushroom",
  crt: "carrot", carr: "carrot", grlc: "garlic", cilan: "cilantro",
  mlk: "milk", whl: "whole", chs: "cheese", ches: "cheese", ched: "cheddar", chdr: "cheddar", mozz: "mozzarella",
  parm: "parmesan", shrd: "shredded", shred: "shredded", crm: "cream", yog: "yogurt", ygt: "yogurt", yogrt: "yogurt",
  grk: "greek", pln: "plain", btr: "butter", bttr: "butter", unsltd: "unsalted", uns: "unsalted", sltd: "salted",
  lg: "large", lrg: "large", eggs: "egg", hvy: "heavy", whp: "whipping",
  bns: "bean", bn: "bean", pnt: "peanut", pnut: "peanut", crmy: "creamy", crnchy: "crunchy", spag: "spaghetti",
  ww: "whole wheat", whwht: "whole wheat", brd: "bread", tort: "tortilla", torts: "tortilla",
  frz: "frozen", frzn: "frozen", fz: "frozen", veg: "vegetable", vegs: "vegetable", veggie: "vegetable",
  oj: "orange juice", jce: "juice", juic: "juice", sprkl: "sparkling", wtr: "water", h2o: "water",
  chps: "chip", crkr: "cracker", ckie: "cookie",
  sce: "sauce", sauc: "sauce", oliv: "olive", evoo: "extra virgin olive oil",
};

/** Store brands / marketing words that carry no food identity. */
const NOISE = new Set([
  "org", "organic", "orgnc", "fresh", "natural", "nat", "all", "premium", "value", "family", "pack", "pk", "pkg",
  "ea", "each", "bag", "tray", "bunch", "lb", "lbs", "oz", "ct", "fl", "count", "gal", "qt", "pt", "kg", "g", "ml", "l",
  "gv", "great", "ks", "kirkland", "signature", "select", "kroger", "market", "pantry", "good", "gather", "trader",
  "joe", "joes", "tj", "tjs", "simple", "truth", "o", "365", "wf", "member", "members", "mark", "heb", "publix",
  "safeway", "wegmans", "store", "brand", "sale", "reg", "regular", "net", "wt", "f", "t", "n", "x", "e", "s",
  "the", "and", "with", "w", "of", "a", "can", "cans", "btl", "bottle", "jar", "box", "pouch",
]);

const UNIT = "(?:lb|lbs|oz|fl\\s?oz|floz|ct|pk|pack|gal|qt|pt|l|ml|kg|g|ea|dz|doz|ct\\.)";

/** Lowercase, strip prices, weights, unit prices, quantities, store codes and noise. */
export function normalizeReceiptLine(raw: string): string {
  let s = ` ${raw.toLowerCase()} `;
  s = s.replace(/[\u2019']/g, "");
  s = s.replace(/@\s*\$?\d+(?:\.\d+)?\s*(?:\/\s*[a-z]+)?/g, " "); // "@ 0.59/lb", "2 @ 1.00"
  s = s.replace(/\$?\d+\.\d{2}\b/g, " "); // prices
  s = s.replace(new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*-?${UNIT}\\b`, "g"), " "); // 1.52lb, 5 oz, 12ct, 3pk
  s = s.replace(/\b\d+\s*x\b|\bx\s*\d+\b/g, " "); // 2x / x2
  s = s.replace(/[^a-z0-9%/ ]+/g, " ");
  s = s.replace(/\b(?:whl|whole|ww) wht\b/g, "whole wheat"); // "wht" alone means white
  const vocab = getIndex().numericTokens;
  const out: string[] = [];
  for (const tok of s.split(/\s+/).filter(Boolean)) {
    if (/\d/.test(tok)) {
      if (vocab.has(tok)) out.push(tok); // keep "80/20", "2%", "93/7"; drop UPCs, PLUs, "31/40"
      continue;
    }
    const expanded = ABBREV[tok] ?? tok;
    for (const t of expanded.split(" ")) if (!NOISE.has(t)) out.push(t);
  }
  return out.map(singular).join(" ");
}

function singular(t: string): string {
  if (t.length <= 3 || /(ss|us|is)$/.test(t)) return t;
  if (t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.endsWith("oes")) return t.slice(0, -2);
  if (t.endsWith("s")) return t.slice(0, -1);
  return t;
}

/** Normalize a fixture alias the same way, minus the receipt-only stripping. */
function normalizeKey(alias: string): string {
  return alias
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9%/ ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t))
    .map(singular)
    .join(" ");
}

interface Key {
  key: string;
  tokens: string[];
  row: NutritionRow;
  isName: boolean;
}

interface Index {
  rows: NutritionRow[];
  exact: Map<string, Key>;
  keys: Key[];
  numericTokens: Set<string>;
  /** Every token of every normalized alias. */
  vocab: Set<string>;
}

let index: Index | null = null;

export function loadNutrition(path = FIXTURE): NutritionRow[] {
  return JSON.parse(readFileSync(path, "utf8")) as NutritionRow[];
}

function getIndex(): Index {
  if (index) return index;
  const rows = loadNutrition();
  const exact = new Map<string, Key>();
  const keys: Key[] = [];
  const numericTokens = new Set<string>();
  for (const row of rows) {
    for (const [i, alias] of [row.item_name, ...row.aliases].entries()) {
      for (const tok of alias.toLowerCase().split(/\s+/)) if (/\d/.test(tok)) numericTokens.add(tok);
      const key = normalizeKey(alias);
      if (!key) continue;
      const k: Key = { key, tokens: key.split(" "), row, isName: i === 0 };
      keys.push(k);
      if (!exact.has(key) || (k.isName && !exact.get(key)!.isName)) exact.set(key, k);
    }
  }
  const vocab = new Set(keys.flatMap((k) => k.tokens));
  index = { rows, exact, keys, numericTokens, vocab };
  return index;
}

/** Similarity of two tokens in 0..1: exact, abbreviation (prefix / ordered subsequence), or edit distance. */
function tokenSim(q: string, c: string, vocab: Set<string>): number {
  if (q === c) return 1;
  // A real word from the fixture vocabulary is not an abbreviation: "cola" must not match "canola".
  if (vocab.has(q)) return 0;
  if (q.length >= 3 && c.startsWith(q)) return 0.9;
  if (c.length >= 4 && q.startsWith(c)) return 0.85;
  if (q.length >= 3 && q[0] === c[0] && isSubsequence(q, c)) return 0.8;
  if (q.length >= 4 && c.length >= 4) {
    const r = 1 - levenshtein(q, c) / Math.max(q.length, c.length);
    if (r >= 0.75) return r * 0.9;
  }
  return 0;
}

function isSubsequence(short: string, long: string): boolean {
  let i = 0;
  for (const ch of long) if (ch === short[i]) i++;
  return i === short.length;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

function score(q: string[], c: string[]): number {
  const v = getIndex().vocab;
  const cand = c.map((ct) => Math.max(...q.map((qt) => tokenSim(qt, ct, v))));
  const query = q.map((qt) => Math.max(...c.map((ct) => tokenSim(qt, ct, v))));
  const candCov = cand.reduce((a, b) => a + b, 0) / c.length;
  const queryCov = query.reduce((a, b) => a + b, 0) / q.length;
  if (candCov < 0.6) return 0; // most of the alias must be present on the line
  return 0.65 * candCov + 0.35 * queryCov;
}

/** Best nutrition row for one receipt line, or null for non-food lines and lines below `minConfidence`. */
export function matchReceiptLine(raw: string, minConfidence = 0.5): NutritionMatch | null {
  if (NON_FOOD.test(raw.toLowerCase())) return null;
  const normalized = normalizeReceiptLine(raw);
  if (!normalized) return null;
  const idx = getIndex();

  const hit = idx.exact.get(normalized);
  if (hit) return { row: hit.row, matched: hit.key, method: "exact", confidence: 1, normalized };

  const q = normalized.split(" ");
  let best: { k: Key; s: number } | null = null;
  for (const k of idx.keys) {
    const s = score(q, k.tokens);
    // ties -> prefer the more specific (longer) alias, then the canonical item name
    if (
      !best ||
      s > best.s + 1e-9 ||
      (Math.abs(s - best.s) <= 1e-9 && (k.tokens.length > best.k.tokens.length || (k.isName && !best.k.isName)))
    ) {
      best = { k, s };
    }
  }
  if (!best || best.s < minConfidence) return null;
  const confidence = Math.round(Math.min(best.s, 0.99) * 100) / 100;
  return { row: best.k.row, matched: best.k.key, method: "fuzzy", confidence, normalized };
}

/**
 * Nutrition for one parsed receipt item: tries the printed line and the LLM's plain-English name and keeps the
 * more confident match. Never throws; returns null when nothing matches (or the fixture can't be loaded).
 */
export function nutritionForItem(item: { raw_name: string; name: string }): ItemNutrition | null {
  try {
    const a = matchReceiptLine(item.raw_name);
    const b = matchReceiptLine(item.name);
    const m = a && (!b || a.confidence >= b.confidence) ? a : b;
    if (!m) return null;
    const r = m.row;
    return {
      fdc_id: r.fdc_id,
      item_name: r.item_name,
      confidence: m.confidence,
      needs_review: m.confidence < NUTRITION_REVIEW_THRESHOLD,
      category: r.category,
      calories_kcal_100g: r.calories_kcal_100g,
      protein_g_100g: r.protein_g_100g,
      carbs_g_100g: r.carbs_g_100g,
      fat_g_100g: r.fat_g_100g,
      fiber_g_100g: r.fiber_g_100g,
      typical_package_size_g: r.typical_package_size_g,
    };
  } catch {
    return null;
  }
}
