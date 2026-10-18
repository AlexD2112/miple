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
 * Server-side enrichment added to each parsed receipt item (never part of the LLM schema above).
 * Per-100 g values from USDA FoodData Central via server/data/nutrition.json; null = not reported.
 */
export const ItemNutrition = z.object({
  fdc_id: z.number().int(),
  item_name: z.string().describe("matched server/data/nutrition.json item_name"),
  confidence: z.number().min(0).max(1).describe("1 = exact alias match"),
  needs_review: z.boolean().describe("true when confidence < NUTRITION_REVIEW_THRESHOLD: ask the user to confirm the match"),
  category: z.enum(CATEGORIES).describe("category of the matched nutrition row (may differ from the LLM's)"),
  calories_kcal_100g: z.number().nullable(),
  protein_g_100g: z.number().nullable(),
  carbs_g_100g: z.number().nullable(),
  fat_g_100g: z.number().nullable(),
  fiber_g_100g: z.number().nullable(),
  typical_package_size_g: z.number(),
});
export type ItemNutrition = z.infer<typeof ItemNutrition>;

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
    .max(2000), // the server keeps the 150 most urgent (pantryForPrompt); big pantries used to 400 here
  remaining: RemainingMacros,
  max_minutes: z.number().int().min(5).max(180),
  count: z.number().int().min(1).max(10).default(5),
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

export function generatedRecipesSchema(staples: boolean) {
  return z.object({
    recipes: z.array(
      RecipeDraft.omit({ ingredients: true }).extend({
        ingredients: z
          .array(
            z.object({
              pantry_item_id: z
                .string()
                .nullable()
                .describe(
                  staples
                    ? "Id from the pantry list. Null only for salt, pepper, butter, or oil."
                    : "Id of this ingredient from the pantry list. Null and unknown ids are invalid.",
                ),
              name: z
                .string()
                .describe(
                  staples
                    ? "The pantry item's name, or salt, pepper, butter, or oil."
                    : "That pantry item's name. Do not rename it into a different food.",
                ),
              quantity: z.string().describe("How much of that ingredient to use."),
            }),
          )
          .min(1),
      }),
    ),
  });
}

export const GeneratedRecipes = generatedRecipesSchema(false);

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
export const FreeWindowInput = z.object({
  start: z.string(),
  end: z.string(),
  minutes: z.number().int(),
  meal: z.enum(["lunch", "dinner"]),
});

export const ChefRequest = z.object({
  messages: z.array(ChefMessage).min(1).max(20),
  plan: z.array(PlannedMeal).max(120),
  pantry: RecipeRequest.shape.pantry,
  remaining: RemainingMacros,
  now: z.string(),
  windows: z.array(FreeWindowInput).max(120),
});

export const CookStep = z.object({
  phase: z.enum(["prep", "cook"]),
  text: z.string(),
  timer_minutes: z.number().int().min(0).max(240).nullable().describe("null when the step has no timer"),
});

export const IngredientGap = z.object({
  name: z.string(),
  quantity: z.string(),
  status: z.enum(["have", "need", "substitute"]),
  pantry_item_id: z.string().nullable().describe("pantry id when status is have or the item being substituted, else null"),
  substitute: z.string().nullable().describe("what to use instead, or null"),
  note: z.string(),
});

/** A meal the user has not accepted yet. Nothing is saved until /recipes/chef/apply. */
export const ChefProposal = z.object({
  action: z.enum(["add", "replace", "skip"]),
  replaces_slot_id: z.string().nullable().describe("existing slot to change, or null when adding"),
  starts_at: z.string().describe("ISO datetime"),
  ends_at: z.string().describe("ISO datetime"),
  recipe: RecipeDraft.nullable().describe("null only when action is skip"),
  guide: z.array(CookStep).max(24),
  gaps: z.array(IngredientGap).max(30),
  shopping_at: z.string().nullable().describe("ISO datetime for a shopping block, or null if nothing to buy"),
  rebuild_week: z.boolean().describe("true when the rest of the week should be replanned around this meal"),
});
export type ChefProposal = z.infer<typeof ChefProposal>;

export const ChefTurn = z.object({
  message: z.string().describe("What you say out loud. No slot ids, no JSON. Ask them to approve before anything changes."),
  proposal: ChefProposal.nullable().describe("null when you are only answering and not changing the plan"),
});

export const ChefApplyRequest = z.object({
  proposal: ChefProposal,
});
