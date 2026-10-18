import { findAllergens, type CheckableRecipe } from "./allergens.js";

/**
 * Diet rules and the reminder the chef gives when a request conflicts with the user's profile.
 * Like allergens, diets are enforced in code: a recipe that breaks the diet is never offered.
 */

const MEAT = [
  "beef", "steak", "pork", "bacon", "ham", "prosciutto", "pancetta", "salami", "pepperoni", "chorizo",
  "sausage", "lamb", "veal", "venison", "bison", "goat", "meatball", "meatloaf", "burger", "hot dog",
  "brisket", "ribs", "jerky", "gelatin", "lard", "carnitas", "al pastor", "bolognese",
];
const POULTRY = ["chicken", "turkey", "duck", "goose", "quail", "cornish hen"];
const PORK = ["pork", "bacon", "ham", "prosciutto", "pancetta", "salami", "pepperoni", "chorizo", "lard", "carnitas", "gelatin"];
const ALCOHOL = ["wine", "beer", "rum", "vodka", "whiskey", "bourbon", "brandy", "sake", "mirin", "liqueur"];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordList = (words: string[]) => new RegExp(`\\b(${words.map(escape).join("|")})(e?s)?\\b`, "i");

/** A diet's forbidden food groups: word lists, or allergen keys reused from the allergen matcher. */
const DIET_RULES: Record<string, { label: string; words?: RegExp; allergens?: string[] }[]> = {
  vegetarian: [
    { label: "meat", words: wordList(MEAT) },
    { label: "poultry", words: wordList(POULTRY) },
    { label: "fish", allergens: ["fish"] },
    { label: "shellfish", allergens: ["shellfish"] },
  ],
  vegan: [
    { label: "meat", words: wordList(MEAT) },
    { label: "poultry", words: wordList(POULTRY) },
    { label: "fish", allergens: ["fish"] },
    { label: "shellfish", allergens: ["shellfish"] },
    { label: "dairy", allergens: ["milk"] },
    { label: "eggs", allergens: ["egg"] },
    { label: "honey", words: wordList(["honey"]) },
  ],
  pescatarian: [
    { label: "meat", words: wordList(MEAT) },
    { label: "poultry", words: wordList(POULTRY) },
  ],
  halal: [
    { label: "pork", words: wordList(PORK) },
    { label: "alcohol", words: wordList(ALCOHOL) },
  ],
  kosher: [
    { label: "pork", words: wordList(PORK) },
    { label: "shellfish", allergens: ["shellfish"] },
  ],
};

/** Food groups in `texts` that the diet does not allow. Unknown or custom diets have no rules. */
export function dietConflicts(texts: string[], diet: string): string[] {
  const rules = DIET_RULES[diet.trim().toLowerCase()];
  if (!rules) return [];
  const joined = texts.join(" \n ");
  return rules
    .filter((rule) => (rule.words ? rule.words.test(joined) : findAllergens(texts, rule.allergens ?? []).length > 0))
    .map((rule) => rule.label);
}

export function violatesDiet(recipe: CheckableRecipe, diet: string): boolean {
  return dietConflicts([recipe.title, ...recipe.ingredients.map((i) => i.name), ...(recipe.steps ?? [])], diet).length > 0;
}

export interface Conflicts {
  allergies: string[];
  dislikes: string[];
  diet: string[];
}

export function requestConflicts(
  text: string,
  profile: { allergies: string[]; dislikes: string[]; diet: string },
): Conflicts {
  return {
    allergies: findAllergens([text], profile.allergies),
    dislikes: findAllergens([text], profile.dislikes),
    diet: dietConflicts([text], profile.diet),
  };
}

export const hasConflicts = (c: Conflicts) => c.allergies.length + c.dislikes.length + c.diet.length > 0;

const ALLERGY_NAMES: Record<string, string> = {
  tree_nut: "tree nuts",
  peanut: "peanuts",
  milk: "dairy",
  egg: "eggs",
  shellfish: "shellfish",
  fish: "fish",
  wheat: "wheat",
  gluten: "gluten",
  soy: "soy",
  sesame: "sesame",
};

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** "Heads up: your profile says you're allergic to peanuts and you eat vegetarian, so ..." */
export function conflictReminder(c: Conflicts, diet: string): string {
  const parts: string[] = [];
  if (c.allergies.length) parts.push(`you're allergic to ${list(c.allergies.map((a) => ALLERGY_NAMES[a] ?? a))}`);
  if (c.diet.length) parts.push(`you eat ${diet.trim().toLowerCase()}, which rules out ${list(c.diet)}`);
  if (c.dislikes.length) parts.push(`you don't like ${list(c.dislikes)}`);
  const avoid = c.allergies.length || c.diet.length ? "so I won't include those" : "so I'll leave that out";
  return `Heads up: your profile says ${list(parts)}, ${avoid}.`;
}
