import { Router } from "express";
import { structured } from "../lib/gemini.js";
import { db, getProfile, requireUser, type AuthedRequest } from "../lib/supabase.js";
import { answerAuditProbe, isAuditProbe } from "../lib/audit.js";
import { containsDisliked, findAllergens, violatesAllergies } from "../domain/allergens.js";
import { CHEF_GUARDRAILS, redactOutput, screenInput } from "../domain/guard.js";
import { groundRecipesToPantry } from "../domain/pantryRecipes.js";
import {
  ChefApplyRequest,
  ChefRequest,
  ChefTurn,
  generatedRecipesSchema,
  RecipeRequest,
  type ChefProposal,
  type RecipeDraft,
} from "../domain/schemas.js";

function recipeSystem(staples: boolean): string {
  const pantryRule = staples
    ? `Every ingredient must be a pantry item with that item's pantry_item_id, except salt, pepper, butter, and oil.
Those four may be added with pantry_item_id null, including olive oil, vegetable oil, and black pepper.
If one of them is already in the pantry, use that pantry id instead. Do not add any other food.`
    : `Every ingredient must be one of the pantry items, and pantry_item_id must be that item's id.
Do not add staples or any food that is not on the list, including oil, salt, pepper, butter, spices, and water.`;
  return `You are Miple's recipe planner for busy students and young professionals on a budget.
Cook only with the pantry items in the list. ${pantryRule}
Do not invent a dish that needs anything else. If the pantry cannot support the requested number, return fewer recipes.
The title and steps may mention only ingredients listed on that recipe.
Prefer items closest to expiring. Macros are per serving and must be honest estimates.
Respect the diet, allergies and dislikes strictly, and list every allergen key the recipe contains.`;
}

const CHEF_SYSTEM = `You are Miple's home chef. Speak in a short, warm, practical voice. Never mention slot ids or JSON.
The user can ask for a specific dish ("shakshuka tonight") or to change the plan. Do not say the plan is already updated.
When they want a meal change, fill proposal and ask them to approve it. Otherwise set proposal to null.
For a requested dish: check the pantry. Mark each ingredient have, need, or substitute. Use pantry_item_id only for
items on the pantry list. Offer a substitute they can make from what they have, and still list anything they must buy.
Put prep and cook in guide, with timer_minutes when a step waits (simmer, rest, roast) and null otherwise.
Pick starts_at and ends_at from the free windows when one fits, including adding a meal that is not on the plan yet.
Set rebuild_week true when this meal should replace the surrounding plan. Respect diet, allergies, and dislikes.

${CHEF_GUARDRAILS}`;

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

  const staples = profile.allow_staples === true;
  const out = await structured(generatedRecipesSchema(staples), {
    system: recipeSystem(staples),
    content: `Plan up to ${count} recipes, each at most ${max_minutes} minutes, aiming to fit one meal within the remaining macros. Use only the pantry list${staples ? ", plus salt, pepper, butter, and oil" : ""}. Drop a recipe instead of adding any other ingredient.\n\n${JSON.stringify(prompt, null, 2)}`,
  });

  const grounded = groundRecipesToPantry(out.recipes, safePantry, { staples });
  const accepted = acceptRecipes(grounded, profile, pantryIds, max_minutes);
  if (accepted.length === 0) return res.json({ recipes: [], rejected: out.recipes.length });

  const data = await insertRecipes(req.userId!, accepted);
  res.json({ recipes: data, rejected: out.recipes.length - accepted.length });
});

/** POST /recipes/chef: one chat turn. Proposals are not saved until /recipes/chef/apply. */
recipes.post("/chef", (req: AuthedRequest, res, next) =>
  isAuditProbe(req) ? answerAuditProbe(req, res, next) : requireUser(req, res, next),
async (req: AuthedRequest, res) => {
  const body = ChefRequest.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const { messages, plan, pantry, remaining, now, windows } = body.data;

  // Refuse known-unsafe requests in code; they never reach the model.
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const refusal = lastUser ? screenInput(lastUser.text) : null;
  if (refusal) return res.json({ message: refusal.message, proposal: null });

  const profile = await getProfile(req.userId!);
  const safePantry = pantry.filter((p) => findAllergens([p.name], profile.allergies).length === 0);

  const prompt = {
    diet: profile.diet,
    allergies: profile.allergies,
    dislikes: profile.dislikes,
    remaining_macros_today: remaining,
    now,
    free_windows: windows,
    pantry: [...safePantry]
      .sort((a, b) => a.days_left - b.days_left)
      .map(({ id, name, quantity, unit, days_left }) => ({ id, name, quantity, unit, days_left })),
    plan,
    transcript: messages.map((m) => ({ role: m.role, text: m.text })),
  };

  const staples = profile.allow_staples === true;
  const turn = await structured(ChefTurn, {
    system: staples
      ? `${CHEF_SYSTEM}\nSalt, pepper, butter, and oil may be used even when they are not in the pantry. Do not mark those four as need or substitute, and do not add them to shopping.`
      : CHEF_SYSTEM,
    content: JSON.stringify(prompt),
  });

  const proposal = turn.proposal ? sanitizeProposal(turn.proposal, profile, new Set(safePantry.map((p) => p.id))) : null;
  let message = redactOutput(turn.message.trim());
  if (turn.proposal && !proposal) {
    message += " I couldn't offer that dish with your allergies and dislikes.";
  }

  res.json({ message, proposal });
});

/** POST /recipes/chef/apply: save a proposal the user accepted. */
recipes.post("/chef/apply", requireUser, async (req: AuthedRequest, res) => {
  const body = ChefApplyRequest.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const profile = await getProfile(req.userId!);
  const { data: pantryRows, error: pantryError } = await db
    .from("items")
    .select("id, name")
    .eq("user_id", req.userId!)
    .eq("status", "active");
  if (pantryError) throw pantryError;
  const pantryIds = new Set(
    (pantryRows ?? [])
      .filter((row) => findAllergens([row.name as string], profile.allergies).length === 0)
      .map((row) => row.id as string),
  );

  const proposal = sanitizeProposal(body.data.proposal, profile, pantryIds);
  if (!proposal) return res.status(400).json({ error: "that meal doesn't fit your allergies or dislikes" });

  const start = new Date(proposal.starts_at);
  const end = new Date(proposal.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return res.status(400).json({ error: "proposal has an invalid time" });
  }

  if (proposal.action === "skip") {
    if (!proposal.replaces_slot_id) return res.status(400).json({ error: "skip needs a meal to skip" });
    const { data, error } = await db
      .from("meal_slots")
      .update({ status: "skipped" })
      .eq("id", proposal.replaces_slot_id)
      .eq("user_id", req.userId!)
      .eq("status", "planned")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "that meal is no longer planned" });
    return res.json({
      slot_id: data.id,
      title: null,
      starts_at: proposal.starts_at,
      ends_at: proposal.ends_at,
      calendar_event_id: null,
      shopping_items: [],
      shopping_at: null,
      rebuild_week: proposal.rebuild_week,
    });
  }

  const recipe = proposal.recipe;
  if (!recipe) return res.status(400).json({ error: "that meal needs a recipe" });
  const [accepted] = acceptRecipes(
    [{ ...recipe, steps: [...recipe.steps, ...proposal.guide.map((step) => step.text)] }],
    profile,
    pantryIds,
    180,
  );
  if (!accepted) return res.status(400).json({ error: "that meal doesn't fit your allergies or dislikes" });

  const guide =
    proposal.guide.length > 0
      ? proposal.guide
      : recipe.steps.map((text) => ({ phase: "cook" as const, text, timer_minutes: null }));
  const [saved] = await insertRecipes(req.userId!, [{ ...accepted, steps: guide }]);

  let slotId = proposal.replaces_slot_id;
  let calendarEventId: string | null = null;
  if (slotId) {
    const existing = await db
      .from("meal_slots")
      .select("id, calendar_event_id")
      .eq("id", slotId)
      .eq("user_id", req.userId!)
      .eq("status", "planned")
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return res.status(404).json({ error: "that meal is no longer planned" });
    calendarEventId = existing.data.calendar_event_id;
    const updated = await db
      .from("meal_slots")
      .update({ recipe_id: saved.id, starts_at: start.toISOString(), ends_at: end.toISOString() })
      .eq("id", slotId)
      .eq("user_id", req.userId!)
      .select("id")
      .maybeSingle();
    if (updated.error) throw updated.error;
  } else {
    const inserted = await db
      .from("meal_slots")
      .insert({
        user_id: req.userId!,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        recipe_id: saved.id,
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    slotId = inserted.data.id;
  }

  const shopping = proposal.gaps.filter((gap) => gap.status === "need" || gap.status === "substitute");
  res.json({
    slot_id: slotId,
    title: saved.title,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    calendar_event_id: calendarEventId,
    shopping_items: shopping.map((gap) => `${gap.quantity} ${gap.name}${gap.substitute ? ` (or ${gap.substitute})` : ""}`),
    shopping_at: proposal.shopping_at,
    rebuild_week: proposal.rebuild_week,
  });
});

function sanitizeProposal(
  proposal: ChefProposal,
  profile: { allergies: string[]; dislikes: string[] },
  pantryIds: Set<string>,
): ChefProposal | null {
  if (proposal.action === "skip") return proposal;
  if (!proposal.recipe) return null;
  const [recipe] = acceptRecipes([proposal.recipe], profile, pantryIds, 180);
  if (!recipe) return null;
  return {
    ...proposal,
    recipe: proposal.recipe,
    gaps: proposal.gaps.map((gap) => ({
      ...gap,
      pantry_item_id: gap.pantry_item_id && pantryIds.has(gap.pantry_item_id) ? gap.pantry_item_id : null,
    })),
  };
}

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
    steps: unknown[];
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
