/**
 * Allergen safety is a hard filter in code. The LLM is told about allergies, but nothing
 * it returns reaches the user without passing `violatesAllergies` first.
 *
 * Matching is deliberately conservative: a false positive drops a safe recipe, a false
 * negative could hurt someone. The regression suite in allergens.regression.test.ts
 * (from miple-testdata large4) covers each group of terms below.
 */

/** Plain English ingredient words. */
const BASE: Record<string, string[]> = {
  peanut: ["peanut", "groundnut", "satay"],
  tree_nut: [
    "almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "macadamia",
    "brazil nut", "pine nut", "praline", "marzipan", "nutella", "pesto",
  ],
  milk: [
    "milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein", "ghee",
    "parmesan", "mozzarella", "cheddar", "feta", "ricotta", "paneer", "kefir", "custard",
  ],
  egg: ["egg", "mayonnaise", "mayo", "meringue", "aioli"],
  wheat: [
    "wheat", "flour", "bread", "pasta", "spaghetti", "noodle", "couscous", "seitan",
    "tortilla", "pita", "bulgur", "semolina", "breadcrumb", "bread crumb", "panko", "soy sauce", "naan",
  ],
  gluten: [
    "wheat", "flour", "bread", "pasta", "spaghetti", "noodle", "couscous", "seitan",
    "tortilla", "pita", "bulgur", "semolina", "breadcrumb", "bread crumb", "panko", "soy sauce", "naan",
    "barley", "rye", "malt", "farro", "spelt",
  ],
  soy: ["soy", "soya", "soybean", "soy sauce", "soya sauce", "tofu", "edamame", "tempeh", "miso", "tamari"],
  fish: [
    "fish", "salmon", "tuna", "cod", "tilapia", "anchovy", "sardine", "trout", "halibut",
    "mackerel", "haddock", "bass", "worcestershire",
  ],
  shellfish: [
    "shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop",
    "crawfish", "crayfish", "squid", "calamari", "octopus",
  ],
  sesame: ["sesame", "tahini", "hummus", "za'atar"],
};

/** Common OCR / LLM misspellings and run-together words. */
const TYPOS: Record<string, string[]> = {
  peanut: ["peanutbutter", "peanutt", "peanus", "penut", "pea nut"],
  tree_nut: [
    "allmond", "almnd", "almod", "cashue", "cashwe", "hazel nut", "hazlenut", "pinnut",
    "pistacho", "pistachoe", "pistacio", "wallnut", "walnt",
  ],
  milk: ["buter", "buttter", "cheeze", "chese", "creme", "heavycream", "parmasan", "parmesean", "parmigian", "yougurt"],
  egg: ["eggz", "egs", "mayonaise", "mayonase"],
  wheat: ["soya sauce", "wheatflour"],
  gluten: ["soya sauce", "wheatflour"],
  soy: ["tofoo"],
  fish: ["samon", "woostershire", "worcester", "worchestershire"],
  shellfish: ["crabmeat", "krab", "shirmp", "srimp"],
  sesame: ["seseme", "sesmae", "tahina", "tahinni"],
};

/** Non-English names, written without accents (text is accent-folded before matching). */
const FOREIGN: Record<string, string[]> = {
  peanut: ["arachide", "cacahuate", "cacahuete", "erdnuss", "erdnusse", "mani"],
  tree_nut: ["almendra", "amande", "mandeln", "noix", "nuez", "nueces", "pinon", "pinones"],
  milk: ["beurre", "crema", "fromage", "kase", "lait", "leche", "mantequilla", "milch", "nata", "queso"],
  egg: ["oeuf", "oeufs", "eier", "huevo", "tamago"],
  wheat: ["farine de ble", "harina de trigo", "salsa de soja", "shoyu", "weizenmehl"],
  gluten: ["farine de ble", "harina de trigo", "salsa de soja", "shoyu", "weizenmehl"],
  soy: ["salsa de soja", "shoyu", "soja"],
  fish: ["anchoa", "atun", "pescado", "poisson"],
  shellfish: ["camaron", "camarones", "cangrejo", "crevette", "ebi", "gamba", "garnele", "garnelen", "kani"],
  sesame: ["ajonjoli", "goma", "sesamo"],
};

/** Dishes and sauces whose names hide an allergen. */
const DISHES: Record<string, string[]> = {
  peanut: ["gado gado", "mole", "pad thai"],
  tree_nut: ["baklava", "dukkah", "korma", "muhammara", "romesco"],
  milk: ["alfredo", "baklava", "bechamel", "caesar", "crab rangoon", "korma", "naan", "pesto", "ranch", "tzatziki"],
  egg: ["caesar", "crab rangoon", "gnocchi", "katsu", "pad thai", "ranch", "tempura", "wonton"],
  wheat: [
    "baklava", "bechamel", "crab rangoon", "gado gado", "gnocchi", "hoisin", "katsu", "muhammara",
    "phyllo", "filo", "ponzu", "satay", "tempura", "teriyaki", "wonton",
  ],
  gluten: [
    "baklava", "bechamel", "crab rangoon", "gado gado", "gnocchi", "hoisin", "katsu", "muhammara",
    "phyllo", "filo", "ponzu", "satay", "tempura", "teriyaki", "wonton",
  ],
  soy: ["gado gado", "hoisin", "ponzu", "satay", "teriyaki"],
  fish: ["bonito", "caesar", "furikake", "kimchi", "pad thai", "pho"],
  shellfish: ["red curry paste", "xo sauce"],
  sesame: ["baba ganoush", "dukkah", "furikake", "hoisin", "mole"],
};

/** Phrases that contain an allergen word but not the allergen. Removed before matching that allergen. */
const NOT_ALLERGEN: Record<string, RegExp[]> = {
  milk: [
    /\b(coconut|oat|almond|soy|soya|rice|cashew|hemp|pea|flax) (milk|yogurt|yoghurt|cream|cheese)s?\b/g,
    /\b(cocoa|shea|peanut|almond|cashew|sunflower seed|seed|nut|apple|pumpkin|soy) butters?\b/g,
    /\bcream of tartar\b/g,
    /\b(dairy|milk|lactose)[\s-]*free( [a-z]+){1,2}/g,
  ],
  gluten: [/\bgluten[\s-]*free( [a-z]+){1,2}/g, /\bcorn tortillas?\b/g, /\brice (flour|noodles?)\b/g],
  wheat: [/\b(gluten|wheat)[\s-]*free( [a-z]+){1,2}/g, /\bcorn tortillas?\b/g, /\brice (flour|noodles?)\b/g],
};

/** Every term per allergen. */
export const ALLERGEN_KEYWORDS: Record<string, string[]> = Object.fromEntries(
  Object.keys(BASE).map((key) => [
    key,
    [...new Set([...BASE[key], ...(TYPOS[key] ?? []), ...(FOREIGN[key] ?? []), ...(DISHES[key] ?? [])])],
  ]),
);

export const ALLERGEN_KEYS = Object.keys(ALLERGEN_KEYWORDS);

// Cyrillic letters that look like Latin ones ("pеanuts" with a Cyrillic е).
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "с": "c", "р": "p", "х": "x", "у": "y",
  "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "һ": "h", "ӏ": "l", "к": "k",
};

/**
 * Folds text so lookalikes match: fullwidth letters, zero-width and soft hyphens, no-break spaces,
 * Cyrillic homoglyphs, ligatures, and accents ("sésamo" -> "sesamo").
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/[  -  ]/g, " ")
    .toLowerCase()
    .replace(/[Ѐ-ӿԀ-ԯ]/g, (c) => HOMOGLYPHS[c] ?? c)
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One term as a regex: spaces may be missing or hyphens ("soysauce", "pine-nuts"); "-y" also matches "-ies". */
function termPattern(term: string): string {
  return escape(normalizeForMatch(term))
    .replace(/ /g, "[\\s-]*")
    .replace(/y$/, "(?:y|ie)");
}

// Whole-word match with optional plural: "egg" matches "eggs" but not "eggplant".
const wordPattern = (terms: string[]) => new RegExp(`\\b(${terms.map(termPattern).join("|")})(e?s)?\\b`, "i");

const patterns = new Map(Object.entries(ALLERGEN_KEYWORDS).map(([key, words]) => [key, wordPattern(words)]));

const freeLabel = new Map(
  Object.entries(ALLERGEN_KEYWORDS).map(([key, words]) => [
    key,
    new RegExp(`\\b(${words.map(termPattern).join("|")})(e?s)?[\\s-]*free\\b`, "g"),
  ]),
);

/** Returns the allergens from `allergies` that appear anywhere in `texts`. */
export function findAllergens(texts: string[], allergies: string[]): string[] {
  const haystack = normalizeForMatch(texts.join(" \n "));
  const hits: string[] = [];
  for (const allergy of allergies) {
    const key = allergy.toLowerCase().trim();
    let text = haystack;
    for (const pattern of NOT_ALLERGEN[key] ?? []) text = text.replace(pattern, " ");
    // "<allergen>-free" is a label, not an ingredient: "peanut-free granola".
    const label = freeLabel.get(key);
    if (label) text = text.replace(label, " ");
    const pattern = patterns.get(key) ?? wordPattern([key]); // unknown allergy: match literally
    if (pattern.test(text)) hits.push(key);
  }
  return hits;
}

export interface CheckableRecipe {
  title: string;
  ingredients: { name: string }[];
  steps?: string[];
  declared_allergens?: string[];
}

/** True if the recipe must not be shown to someone with these allergies. */
export function violatesAllergies(recipe: CheckableRecipe, allergies: string[]): boolean {
  if (allergies.length === 0) return false;
  const declared = (recipe.declared_allergens ?? []).map((a) => a.toLowerCase());
  if (allergies.some((a) => declared.includes(a.toLowerCase()))) return true;
  const texts = [recipe.title, ...recipe.ingredients.map((i) => i.name), ...(recipe.steps ?? [])];
  return findAllergens(texts, allergies).length > 0;
}

/** Same filter for dislikes. Dislikes are not dangerous, but users hate seeing them. */
export function containsDisliked(recipe: CheckableRecipe, dislikes: string[]): boolean {
  if (dislikes.length === 0) return false;
  return findAllergens([recipe.title, ...recipe.ingredients.map((i) => i.name)], dislikes).length > 0;
}
