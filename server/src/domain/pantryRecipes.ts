export interface PantryFood {
  id: string;
  name: string;
}

export interface DraftIngredient {
  pantry_item_id: string | null;
  name: string;
  quantity: string;
}

/** True when the ingredient is that pantry item, allowing extra words and a trailing plural. */
export function samePantryFood(ingredientName: string, pantryName: string): boolean {
  const ingredient = tokens(ingredientName);
  const pantry = tokens(pantryName);
  if (ingredient.length === 0 || pantry.length === 0) return false;
  return covers(pantry, ingredient) || covers(ingredient, pantry);
}

const STAPLE_ROOTS = new Set(["salt", "pepper", "butter", "oil"]);
const STAPLE_MODIFIERS = new Set([
  "black",
  "white",
  "ground",
  "sea",
  "kosher",
  "olive",
  "vegetable",
  "canola",
  "cooking",
  "extra",
  "virgin",
  "unsalted",
  "salted",
]);

/** Salt, pepper, butter, and oil, including common forms such as olive oil. Not bell pepper or other foods. */
export function isAllowedStaple(name: string): boolean {
  const parts = words(name).map(stem);
  if (parts.length === 0 || parts.length > 4) return false;
  if (parts.some((word) => word === "bell" || word === "chili" || word === "chilli")) return false;
  if (!parts.some((word) => STAPLE_ROOTS.has(word))) return false;
  return parts.every((word) => STAPLE_ROOTS.has(word) || STAPLE_MODIFIERS.has(word));
}

/**
 * Keep a recipe only when every ingredient is a pantry item.
 * Names are rewritten to the pantry name so a real id cannot be labeled as a different food.
 * When `staples` is set, salt, pepper, butter, and oil may appear with a null pantry id.
 */
export function groundRecipesToPantry<T extends { ingredients: DraftIngredient[] }>(
  drafts: T[],
  pantry: PantryFood[],
  options?: { staples?: boolean },
): T[] {
  const names = new Map(pantry.map((item) => [item.id, item.name]));
  return drafts.flatMap((draft) => {
    if (draft.ingredients.length === 0) return [];
    const ingredients: DraftIngredient[] = [];
    for (const ingredient of draft.ingredients) {
      const pantryName = ingredient.pantry_item_id ? names.get(ingredient.pantry_item_id) : undefined;
      if (pantryName && samePantryFood(ingredient.name, pantryName)) {
        ingredients.push({ ...ingredient, name: pantryName });
        continue;
      }
      if (options?.staples && !ingredient.pantry_item_id && isAllowedStaple(ingredient.name)) {
        ingredients.push({ ...ingredient, pantry_item_id: null, name: ingredient.name.trim() });
        continue;
      }
      return [];
    }
    return [{ ...draft, ingredients }];
  });
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokens(value: string): string[][] {
  return words(value).map(forms);
}

function forms(word: string): string[] {
  const variants = new Set([word]);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) variants.add(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("es")) variants.add(word.slice(0, -2));
  return [...variants];
}

function covers(needles: string[][], haystack: string[][]): boolean {
  return needles.every((needle) => haystack.some((word) => needle.some((form) => word.includes(form))));
}
