import type { FreeWindow } from "./calendar";
import { daysUntil } from "./dates";
import type { Item, Macros, Recipe } from "./types";

/**
 * Ranking: urgency of pantry items used (50%), macro fit (30%), time fit (20%).
 * Pure functions so they're easy to tune and test.
 */
export const WEIGHTS = { urgency: 0.5, macros: 0.3, time: 0.2 };

export function urgencyScore(recipe: Recipe, itemsById: Map<string, Item>, claimed: Set<string>): number {
  let score = 0;
  for (const ing of recipe.ingredients) {
    if (!ing.item_id || claimed.has(ing.item_id)) continue;
    const item = itemsById.get(ing.item_id);
    if (!item) continue;
    score += 1 / (1 + Math.max(0, daysUntil(item.estimated_expiry)));
  }
  return Math.min(1, score / 1.5);
}

export function macroFitScore(recipe: Macros, target: Macros): number {
  const parts: [number, number][] = [
    [recipe.calories, target.calories],
    [recipe.protein_g, target.protein_g],
    [recipe.carbs_g, target.carbs_g],
    [recipe.fat_g, target.fat_g],
  ];
  const errors = parts.map(([got, want]) => (want <= 0 ? (got > 0 ? 1 : 0) : Math.min(1, Math.abs(got - want) / want)));
  // Protein counts double: under-eating protein is the most common gap.
  return 1 - (errors[0] + 2 * errors[1] + errors[2] + errors[3]) / 5;
}

export function timeFitScore(recipeMinutes: number, slotMinutes: number): number {
  if (recipeMinutes > slotMinutes) return 0;
  return 1 - 0.3 * (recipeMinutes / slotMinutes); // shorter is a little better
}

export function scoreRecipe(
  recipe: Recipe,
  ctx: { itemsById: Map<string, Item>; claimed: Set<string>; perMealTarget: Macros; slotMinutes: number },
): number {
  const time = timeFitScore(recipe.minutes, ctx.slotMinutes);
  if (time === 0) return -1;
  return (
    WEIGHTS.urgency * urgencyScore(recipe, ctx.itemsById, ctx.claimed) +
    WEIGHTS.macros * macroFitScore(recipe, ctx.perMealTarget) +
    WEIGHTS.time * time
  );
}

export interface PlannedMeal {
  window: FreeWindow;
  recipe: Recipe;
  score: number;
}

/**
 * Greedy, chronological: earliest slot gets the best recipe, and items it uses are "claimed"
 * so later slots are pushed toward the next most urgent food.
 */
export function assignRecipes(
  windows: FreeWindow[],
  recipes: Recipe[],
  items: Item[],
  remainingToday: Macros,
  dailyTarget: Macros,
): PlannedMeal[] {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const claimed = new Set<string>();
  const used = new Set<string>();
  const plan: PlannedMeal[] = [];
  const today = new Date().toDateString();
  const mealsLeftToday = Math.max(1, windows.filter((w) => w.start.toDateString() === today).length);

  for (const window of [...windows].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const perMealTarget =
      window.start.toDateString() === today ? divide(remainingToday, mealsLeftToday) : divide(dailyTarget, 3);

    let best: { recipe: Recipe; score: number } | null = null;
    for (const recipe of recipes) {
      if (used.has(recipe.id)) continue;
      const score = scoreRecipe(recipe, { itemsById, claimed, perMealTarget, slotMinutes: window.minutes });
      if (score > (best?.score ?? 0)) best = { recipe, score };
    }
    if (!best) continue;

    used.add(best.recipe.id);
    best.recipe.ingredients.forEach((i) => i.item_id && claimed.add(i.item_id));
    plan.push({ window, ...best });
  }
  return plan;
}

const divide = (m: Macros, n: number): Macros => ({
  calories: m.calories / n,
  protein_g: m.protein_g / n,
  carbs_g: m.carbs_g / n,
  fat_g: m.fat_g / n,
});
