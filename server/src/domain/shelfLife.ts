import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CATEGORIES } from "./schemas.js";

/**
 * Per-item shelf life from USDA FoodKeeper (server/data/foodkeeper.json, built by
 * scripts/build-foodkeeper.mjs). The category table in Postgres is the fallback; this lets
 * apples (4 weeks in the fridge) and bananas (3 days) stop sharing one "fresh fruit" value.
 */

type Category = (typeof CATEGORIES)[number];
type Storage = "fridge" | "pantry" | "freezer";

interface FoodKeeperProduct {
  id: number;
  group: string;
  name: string;
  subtitle: string;
  keywords: string[];
  fridge_days: number | null;
  pantry_days: number | null;
  freezer_days: number | null;
}

export interface ItemShelfLife {
  days: number;
  storage: Storage;
  source: "usda_foodkeeper";
  product_id: number;
  product: string;
}

const PRODUCE_VEG = ["Produce / Fresh Vegetables"];
const PRODUCE_FRUIT = ["Produce / Fresh Fruits"];
const DAIRY = ["Dairy Products & Eggs"];
const SHELF = ["Shelf Stable Foods"];

/** FoodKeeper groups an item of this category may match, and where it is normally stored. */
const CATEGORY_RULES: Record<Category, { groups: string[]; storage: Storage[] }> = {
  leafy_greens: { groups: PRODUCE_VEG, storage: ["fridge"] },
  fresh_vegetables: { groups: PRODUCE_VEG, storage: ["fridge", "pantry"] },
  root_vegetables: { groups: PRODUCE_VEG, storage: ["pantry", "fridge"] },
  herbs: { groups: PRODUCE_VEG, storage: ["fridge"] },
  berries: { groups: PRODUCE_FRUIT, storage: ["fridge"] },
  fresh_fruit: { groups: PRODUCE_FRUIT, storage: ["fridge", "pantry"] },
  raw_poultry: { groups: ["Poultry / Fresh"], storage: ["fridge"] },
  raw_meat: { groups: ["Meat / Fresh"], storage: ["fridge"] },
  raw_seafood: { groups: ["Seafood / Fresh", "Seafood / Shellfish"], storage: ["fridge"] },
  deli_meat: { groups: ["Meat / Smoked or Processed", "Deli & Prepared Foods", "Poultry / Cooked or Processed"], storage: ["fridge"] },
  dairy_milk: { groups: DAIRY, storage: ["fridge"] },
  dairy_cheese: { groups: DAIRY, storage: ["fridge"] },
  yogurt: { groups: DAIRY, storage: ["fridge"] },
  eggs: { groups: DAIRY, storage: ["fridge"] },
  tofu: { groups: ["Vegetarian Proteins"], storage: ["fridge"] },
  bread: { groups: ["Baked Goods / Bakery"], storage: ["pantry", "fridge"] },
  tortillas: { groups: ["Baked Goods / Bakery"], storage: ["pantry", "fridge"] },
  cooked_leftovers: { groups: ["Deli & Prepared Foods", "Poultry / Cooked or Processed"], storage: ["fridge"] },
  frozen: { groups: ["Food Purchased Frozen"], storage: ["freezer"] },
  canned: { groups: ["Condiments, Sauces & Canned Goods", ...SHELF], storage: ["pantry"] },
  dry_goods: { groups: ["Grains, Beans & Pasta", "Baked Goods / Baking and Cooking", ...SHELF], storage: ["pantry"] },
  condiments: { groups: ["Condiments, Sauces & Canned Goods", ...SHELF], storage: ["pantry", "fridge"] },
  snacks: { groups: [...SHELF, "Baked Goods / Bakery"], storage: ["pantry"] },
  beverages: { groups: ["Beverages"], storage: ["pantry", "fridge"] },
  other: { groups: [], storage: ["fridge"] },
};

const IMPLIED: Partial<Record<Category, string[]>> = {
  canned: ["canned"],
  frozen: ["frozen"],
  cooked_leftovers: ["cooked", "leftover"],
};

/** Words that never identify a food on their own. */
const GENERIC = new Set([
  "fresh", "raw", "whole", "organic", "commercial", "commercially", "large", "small", "medium", "sliced",
  "plain", "regular", "store", "bought", "package", "packaged", "brand", "natural", "and", "or", "of", "the",
  "with", "in", "a", "such", "as", "etc", "type", "all", "kind", "kinds", "lb", "oz", "ct", "pack",
  "part", "piece", "product", "food", "item", "red", "green", "yellow", "white", "brown", "baby", "mini",
  "lean", "extra", "skinless", "free", "range", "grade", "greek", "nonfat", "lowfat", "low", "fat", "reduced",
  "sodium", "unsalted", "seedless", "ripe", "bunch", "bag", "bagged", "loose", "family", "value", "bell",
  "firm", "silken", "black",
]);

/** Product states that make a match wrong unless the item says so too. */
const PROCESSED = new Set([
  "cooked", "homemade", "canned", "frozen", "instant", "dried", "dehydrated", "smoked", "opened", "leftover",
  "leftovers", "prepared", "baked", "fried", "thawed", "mix", "mixes", "cured", "pickled", "jarred", "powder",
  "powdered", "evaporated", "condensed", "concentrate", "boiled", "fermented",
  // Derived products: "black bean sauce" is not "black beans".
  "sauce", "juice", "jam", "jelly", "soup", "dressing", "spread", "pie", "salad", "chip", "bar", "cake",
  "cookie", "pudding", "substitute", "dip", "paste", "syrup", "flake", "meal", "mix",
]);

const singular = (w: string) =>
  w.length > 3 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("es") && /(ch|sh|x|o)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singular);
}

interface Indexed {
  product: FoodKeeperProduct;
  phrases: string[][];
  /** Name alternatives: "Ground turkey or chicken" -> [["ground","turkey"],["chicken"]]. */
  nameOptions: string[][];
  /** Every distinctive word in the name, subtitle and keywords. */
  vocabulary: Set<string>;
  qualifiers: Set<string>;
  processed: Set<string>;
}

let index: Indexed[] | null = null;

function load(): Indexed[] {
  if (index) return index;
  const path = fileURLToPath(new URL("../../data/foodkeeper.json", import.meta.url));
  const data = JSON.parse(readFileSync(path, "utf8")) as { products: FoodKeeperProduct[] };
  index = data.products.map((product) => {
    const phrases = [product.name, ...product.keywords]
      .map(tokens)
      .map((t) => t.filter((w) => !GENERIC.has(w)))
      .filter((t) => t.length > 0);
    const described = [...tokens(product.name), ...tokens(product.subtitle)];
    return {
      product,
      phrases,
      nameOptions: product.name
        .split(/or|,/i)
        .map((part) => tokens(part).filter((w) => !GENERIC.has(w)))
        .filter((t) => t.length > 0),
      vocabulary: new Set(
        [product.name, product.subtitle, ...product.keywords].flatMap(tokens).filter((w) => !GENERIC.has(w)),
      ),
      qualifiers: new Set(tokens(product.subtitle).filter((w) => !GENERIC.has(w))),
      processed: new Set(described.filter((w) => PROCESSED.has(w))),
    };
  });
  return index;
}

/**
 * The FoodKeeper shelf life for an item, or null when no product in a fitting group matches
 * confidently. Callers fall back to the category's shelf life.
 */
export function itemShelfLife(name: string, category: string): ItemShelfLife | null {
  const rules = CATEGORY_RULES[category as Category];
  if (!rules || rules.groups.length === 0) return null;
  const item = new Set(tokens(name));
  // Category implies a state the name may leave out: a canned item is canned even if called "black beans".
  for (const implied of IMPLIED[category as Category] ?? []) item.add(implied);
  const distinctive = [...item].filter((w) => !GENERIC.has(w) && !PROCESSED.has(w));
  if (distinctive.length === 0) return null;

  let best: { entry: Indexed; score: number } | null = null;
  for (const entry of load()) {
    if (!rules.groups.includes(entry.product.group)) continue;
    const matched = entry.phrases.filter((phrase) => phrase.every((w) => item.has(w)));
    if (matched.length === 0) continue;

    // Every distinctive word of the item must appear in the product ("sour cream" is not whipping cream).
    if (distinctive.some((w) => !entry.vocabulary.has(w))) continue;

    let score = Math.max(...matched.map((p) => p.length)) * 2;
    for (const q of entry.qualifiers) if (item.has(q)) score += 1;
    for (const p of entry.processed) if (!item.has(p)) score -= 3;
    // Prefer products whose own name is the item ("Eggs" over "Eggnog", "Grapes" over "Citrus fruit").
    const missing = Math.min(...entry.nameOptions.map((option) => option.filter((w) => !item.has(w)).length));
    score += missing === 0 ? 3 : -1;
    if (score <= 0) continue;
    if (!best || score > best.score || (score === best.score && entry.product.id < best.entry.product.id)) {
      best = { entry, score };
    }
  }
  if (!best) return null;

  const p = best.entry.product;
  for (const storage of rules.storage) {
    const days = storage === "fridge" ? p.fridge_days : storage === "pantry" ? p.pantry_days : p.freezer_days;
    if (days) {
      const product = p.subtitle ? `${p.name} (${p.subtitle})` : p.name;
      return { days, storage, source: "usda_foodkeeper", product_id: p.id, product };
    }
  }
  return null;
}
