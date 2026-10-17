import { z } from "zod";

// Must match the rows in supabase/migrations/0001_init.sql (shelf_life table).
export const CATEGORIES = [
  "leafy_greens", "berries", "fresh_fruit", "fresh_vegetables", "root_vegetables", "herbs",
  "raw_poultry", "raw_meat", "raw_seafood", "deli_meat", "dairy_milk", "dairy_cheese",
  "yogurt", "eggs", "tofu", "bread", "tortillas", "cooked_leftovers", "frozen", "canned",
  "dry_goods", "condiments", "snacks", "beverages", "other",
] as const;

export const ParsedReceipt = z.object({
  store: z.string().nullable(),
  purchased_at: z.string().nullable().describe("YYYY-MM-DD, null if not printed"),
  total: z.number().nullable(),
  items: z.array(
    z.object({
      raw_name: z.string().describe("The line exactly as printed, e.g. 'ORG SPNCH 5OZ'"),
      name: z.string().describe("Plain-English food name, e.g. 'organic spinach'"),
      category: z.enum(CATEGORIES),
      quantity: z.number(),
      unit: z.string().nullable().describe("oz, lb, ct, bunch, ... or null"),
      price: z.number().nullable(),
      is_food: z.boolean().describe("false for bags, deposits, discounts, tax, non-food"),
    }),
  ),
});
export type ParsedReceipt = z.infer<typeof ParsedReceipt>;

/**
 * The ONLY health-derived data the server accepts or forwards to the LLM: four numbers.
 * Raw HealthKit samples (timestamps, sources, workouts, weight) never leave the device.
 */
export const RemainingMacros = z.object({
  calories: z.number().min(0).max(10000),
  protein_g: z.number().min(0).max(1000),
  carbs_g: z.number().min(0).max(2000),
  fat_g: z.number().min(0).max(1000),
});
export type RemainingMacros = z.infer<typeof RemainingMacros>;

export const RecipeRequest = z.object({
  pantry: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().max(120),
        category: z.string(),
        quantity: z.number(),
        unit: z.string().nullable(),
        days_left: z.number(),
      }),
    )
    .max(200),
  remaining: RemainingMacros,
  max_minutes: z.number().int().min(5).max(180),
  count: z.number().int().min(1).max(8).default(5),
});

export const RecipeDraft = z.object({
  title: z.string(),
  minutes: z.number().int(),
  servings: z.number().int(),
  ingredients: z.array(
    z.object({
      pantry_item_id: z.string().nullable().describe("id from the pantry list, or null for staples"),
      name: z.string(),
      quantity: z.string(),
    }),
  ),
  steps: z.array(z.string()),
  calories: z.number().int().describe("per serving"),
  protein_g: z.number().int(),
  carbs_g: z.number().int(),
  fat_g: z.number().int(),
  declared_allergens: z
    .array(z.string())
    .describe("allergen keys present: peanut, tree_nut, milk, egg, wheat, gluten, soy, fish, shellfish, sesame"),
});
export type RecipeDraft = z.infer<typeof RecipeDraft>;

export const GeneratedRecipes = z.object({
  recipes: z.array(RecipeDraft),
});

export const ChefMessage = z.object({
  role: z.enum(["user", "chef"]),
  text: z.string().max(2000),
});

export const PlannedMeal = z.object({
  slot_id: z.string().uuid(),
  starts_at: z.string(),
  ends_at: z.string(),
  minutes_available: z.number().int().min(5).max(240),
  title: z.string(),
  minutes: z.number(),
  calories: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  ingredients: z.array(z.string()).max(40),
});

/** Chat turns plus the plan the chef is allowed to change. Allergies still come from the database. */
export const ChefRequest = z.object({
  messages: z.array(ChefMessage).min(1).max(20),
  plan: z.array(PlannedMeal).max(20),
  pantry: RecipeRequest.shape.pantry,
  remaining: RemainingMacros,
});

export const ChefTurn = z.object({
  message: z.string().describe("What you say out loud. No slot ids, no JSON."),
  changes: z.array(
    z.object({
      slot_id: z.string().describe("slot_id copied from the current plan"),
      action: z.enum(["replace", "skip"]),
      recipe: RecipeDraft.nullable().describe("full new recipe when action is replace, otherwise null"),
    }),
  ),
});
