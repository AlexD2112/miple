/**
 * Allergen safety is a hard filter in code. The LLM is told about allergies, but nothing
 * it returns reaches the user without passing `violatesAllergies` first.
 *
 * Matching is deliberately conservative: a false positive drops a safe recipe, a false
 * negative could hurt someone.
 */
export const ALLERGEN_KEYWORDS: Record<string, string[]> = {
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
    "tortilla", "pita", "bulgur", "semolina", "breadcrumb", "panko", "soy sauce", "naan",
  ],
  gluten: [
    "wheat", "flour", "bread", "pasta", "spaghetti", "noodle", "couscous", "seitan",
    "tortilla", "pita", "bulgur", "semolina", "breadcrumb", "panko", "soy sauce", "naan",
    "barley", "rye", "malt", "farro", "spelt",
  ],
  soy: ["soy", "soya", "tofu", "edamame", "tempeh", "miso", "tamari"],
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

export const ALLERGEN_KEYS = Object.keys(ALLERGEN_KEYWORDS);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word match with optional plural: "egg" matches "eggs" but not "eggplant".
const patterns = new Map(
  Object.entries(ALLERGEN_KEYWORDS).map(([key, words]) => [
    key,
    new RegExp(`\\b(${words.map(escape).join("|")})(e?s)?\\b`, "i"),
  ]),
);

/** Returns the allergens from `allergies` that appear anywhere in `texts`. */
export function findAllergens(texts: string[], allergies: string[]): string[] {
  const haystack = texts.join(" \n ").toLowerCase();
  const hits: string[] = [];
  for (const allergy of allergies) {
    const key = allergy.toLowerCase().trim();
    const pattern =
      patterns.get(key) ?? new RegExp(`\\b${escape(key)}(e?s)?\\b`, "i"); // unknown allergy: match literally
    if (pattern.test(haystack)) hits.push(key);
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
