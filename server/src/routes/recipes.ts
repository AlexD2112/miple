import { Router } from "express";
import { structured } from "../lib/gemini.js";
import { db, getProfile, requireUser, type AuthedRequest } from "../lib/supabase.js";
import { containsDisliked, findAllergens, violatesAllergies } from "../domain/allergens.js";
import { ChefRequest, ChefTurn, GeneratedRecipes, RecipeRequest, type RecipeDraft } from "../domain/schemas.js";

const SYSTEM = `You are Miple's recipe planner for busy students and young professionals on a budget.
Create simple, realistic recipes that use the pantry items closest to expiring first.
Use pantry_item_id for every ingredient that comes from the pantry list; use null only for basic
staples (oil, salt, pepper, spices, water). Macros are per serving and must be honest estimates.
Respect the diet, allergies and dislikes strictly, and list every allergen key the recipe contains.`;

const CHEF_SYSTEM = `You are Miple's home chef. The user already has a meal plan and is talking to you to adjust it.
Speak in a short, warm, practical voice. Your message is shown in chat: never mention slot ids or JSON.
You may replace a planned meal with a new recipe or skip it. Leave changes empty when you are only answering.
Only use slot_id values from the current plan. A replacement recipe must fit minutes_available, use pantry items
closest to expiring, and respect diet, allergies, and dislikes. Use pantry_item_id from the pantry list, or null
for staples. If they ask for meals that are not on the plan yet, tell them to tap Plan my meals first.`;

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
  });

  const accepted = acceptRecipes(out.recipes, profile, pantryIds, max_minutes);
  if (accepted.length === 0) return res.json({ recipes: [], rejected: out.recipes.length });

  const data = await insertRecipes(req.userId!, accepted);
  res.json({ recipes: data, rejected: out.recipes.length - accepted.length });
});

/**
 * POST /recipes/chef: one chat turn. The model may replace or skip planned slots.
 * New recipes go through the same allergen and dislike filters as /generate.
 */
recipes.post("/chef", requireUser, async (req: AuthedRequest, res) => {
  const body = ChefRequest.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const { messages, plan, pantry, remaining } = body.data;

  const profile = await getProfile(req.userId!);
  const safePantry = pantry.filter((p) => findAllergens([p.name], profile.allergies).length === 0);
  const pantryIds = new Set(safePantry.map((p) => p.id));
  const slots = new Map(plan.map((slot) => [slot.slot_id, slot]));

  const prompt = {
    diet: profile.diet,
    allergies: profile.allergies,
    dislikes: profile.dislikes,
    remaining_macros_today: remaining,
    pantry: [...safePantry]
      .sort((a, b) => a.days_left - b.days_left)
      .map(({ id, name, quantity, unit, days_left }) => ({ id, name, quantity, unit, days_left })),
    plan,
    transcript: messages.map((m) => ({ role: m.role, text: m.text })),
  };

  const turn = await structured(ChefTurn, {
    system: CHEF_SYSTEM,
    content: JSON.stringify(prompt),
  });

  const applied: { slot_id: string; action: "replace" | "skip"; title: string | null }[] = [];
  let rejected = 0;
  let clearedCalendar = false;

  for (const change of turn.changes) {
    const slot = slots.get(change.slot_id);
    if (!slot) {
      rejected += 1;
      continue;
    }

    if (change.action === "skip") {
      const { data, error } = await db
        .from("meal_slots")
        .update({ status: "skipped" })
        .eq("id", slot.slot_id)
        .eq("user_id", req.userId!)
        .eq("status", "planned")
        .select("id");
      if (error) throw error;
      if (!data?.length) {
        rejected += 1;
        continue;
      }
      applied.push({ slot_id: slot.slot_id, action: "skip", title: slot.title });
      continue;
    }

    if (!change.recipe) {
      rejected += 1;
      continue;
    }
    const [recipe] = acceptRecipes([change.recipe], profile, pantryIds, slot.minutes_available);
    if (!recipe) {
      rejected += 1;
      continue;
    }
    const [saved] = await insertRecipes(req.userId!, [recipe]);
    const existing = await db
      .from("meal_slots")
      .select("calendar_event_id")
      .eq("id", slot.slot_id)
      .eq("user_id", req.userId!)
      .eq("status", "planned")
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) {
      rejected += 1;
      continue;
    }
    const { data, error } = await db
      .from("meal_slots")
      .update({ recipe_id: saved.id, calendar_event_id: null })
      .eq("id", slot.slot_id)
      .eq("user_id", req.userId!)
      .eq("status", "planned")
      .select("id");
    if (error) throw error;
    if (!data?.length) {
      rejected += 1;
      continue;
    }
    if (existing.data.calendar_event_id) clearedCalendar = true;
    applied.push({ slot_id: slot.slot_id, action: "replace", title: saved.title });
  }

  let message = turn.message.trim();
  if (rejected > 0) {
    message += " I dropped a change that didn't fit your allergies, dislikes, or the time you have.";
  }
  if (clearedCalendar && applied.some((a) => a.action === "replace")) {
    message += " Re-add any changed meals to your calendar so the event matches the new recipe.";
  }

  res.json({ message, applied, rejected });
});

function acceptRecipes(
  drafts: RecipeDraft[],
  profile: { allergies: string[]; dislikes: string[] },
  pantryIds: Set<string>,
  maxMinutes: number,
) {
  return drafts
    .filter((r) => r.minutes <= maxMinutes)
    .filter((r) => !violatesAllergies(r, profile.allergies))
    .filter((r) => !containsDisliked(r, profile.dislikes))
    .map((r) => ({
      ...r,
      ingredients: r.ingredients.map((i) => ({
        item_id: i.pantry_item_id && pantryIds.has(i.pantry_item_id) ? i.pantry_item_id : null,
        name: i.name,
        quantity: i.quantity,
      })),
    }));
}

async function insertRecipes(
  userId: string,
  accepted: {
    title: string;
    ingredients: { item_id: string | null; name: string; quantity: string }[];
    steps: string[];
    minutes: number;
    servings: number;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  }[],
) {
  const { data, error } = await db
    .from("recipes")
    .insert(
      accepted.map((r) => ({
        user_id: userId,
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
  if (error || !data) throw error ?? new Error("recipe insert returned no rows");
  return data;
}
