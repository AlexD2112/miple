import { Router } from "express";
import { structured } from "../lib/claude.js";
import { db, getProfile, requireUser, type AuthedRequest } from "../lib/supabase.js";
import { containsDisliked, findAllergens, violatesAllergies } from "../domain/allergens.js";
import { GeneratedRecipes, RecipeRequest } from "../domain/schemas.js";

const SYSTEM = `You are Miple's recipe planner for busy students and young professionals on a budget.
Create simple, realistic recipes that use the pantry items closest to expiring first.
Use pantry_item_id for every ingredient that comes from the pantry list; use null only for basic
staples (oil, salt, pepper, spices, water). Macros are per serving and must be honest estimates.
Respect the diet, allergies and dislikes strictly, and list every allergen key the recipe contains.`;

export const recipes = Router();

/** POST /recipes/generate: returns allergen-safe recipes saved to the user's account. */
recipes.post("/generate", requireUser, async (req: AuthedRequest, res) => {
  const body = RecipeRequest.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const { pantry, remaining, max_minutes, count } = body.data;

  // Allergies come from the database, never from the request body.
  const profile = await getProfile(req.userId!);

  // Don't even offer the model pantry items the user is allergic to.
  const safePantry = pantry.filter((p) => findAllergens([p.name], profile.allergies).length === 0);
  const pantryIds = new Set(safePantry.map((p) => p.id));

  const prompt = {
    diet: profile.diet,
    allergies: profile.allergies,
    dislikes: profile.dislikes,
    // Only aggregate remaining-macro numbers: no raw health data is ever sent to the LLM.
    remaining_macros_today: remaining,
    max_minutes,
    recipes_wanted: count,
    pantry: [...safePantry]
      .sort((a, b) => a.days_left - b.days_left)
      .map(({ id, name, quantity, unit, days_left }) => ({ id, name, quantity, unit, days_left })),
  };

  const out = await structured(GeneratedRecipes, {
    system: SYSTEM,
    content: `Plan ${count} recipes, each at most ${max_minutes} minutes, aiming to fit one meal within the remaining macros.\n\n${JSON.stringify(prompt, null, 2)}`,
    effort: "medium",
  });

  const accepted = out.recipes
    .filter((r) => r.minutes <= max_minutes)
    .filter((r) => !violatesAllergies(r, profile.allergies))
    .filter((r) => !containsDisliked(r, profile.dislikes))
    .map((r) => ({
      ...r,
      // Drop any id the model invented.
      ingredients: r.ingredients.map((i) => ({
        item_id: i.pantry_item_id && pantryIds.has(i.pantry_item_id) ? i.pantry_item_id : null,
        name: i.name,
        quantity: i.quantity,
      })),
    }));

  if (accepted.length === 0) return res.json({ recipes: [], rejected: out.recipes.length });

  const { data, error } = await db
    .from("recipes")
    .insert(
      accepted.map((r) => ({
        user_id: req.userId,
        title: r.title,
        ingredients: r.ingredients,
        steps: r.steps,
        minutes: r.minutes,
        servings: r.servings,
        calories: r.calories,
        protein_g: r.protein_g,
        carbs_g: r.carbs_g,
        fat_g: r.fat_g,
      })),
    )
    .select("*");
  if (error) throw error;

  res.json({ recipes: data, rejected: out.recipes.length - accepted.length });
});
