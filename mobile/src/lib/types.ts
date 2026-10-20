export type ItemStatus = "active" | "used" | "wasted";
export type ItemSource = "receipt" | "manual" | "leftover" | "fridge_scan";

export interface Profile {
  id: string;
  display_name: string | null;
  diet: string;
  allergies: string[];
  dislikes: string[];
  calorie_target: number;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
  phone: string | null;
  nudges_enabled: boolean;
  allow_staples: boolean;
  healthkit_enabled: boolean;
  timezone: string;
}

export interface Receipt {
  id: string;
  store: string | null;
  purchased_at: string;
  total: number | null;
}

export interface Item {
  id: string;
  receipt_id: string | null;
  name: string;
  raw_name: string | null;
  category: string;
  quantity: number;
  unit: string | null;
  price: number | null;
  purchase_date: string;
  estimated_expiry: string;
  status: ItemStatus;
  source: ItemSource;
  updated_at: string;
}

export interface Macros {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export type RecipeStep =
  | string
  | { phase?: "prep" | "cook" | string; text: string; timer_minutes?: number | null };

export interface Recipe extends Macros {
  id: string;
  title: string;
  ingredients: { item_id: string | null; name: string; quantity: string }[];
  steps: RecipeStep[];
  minutes: number;
  servings: number;
}

export function stepText(step: RecipeStep): string {
  return typeof step === "string" ? step : step.text;
}

export interface MealSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  recipe_id: string | null;
  calendar_event_id: string | null;
  shopping_event_id?: string | null;
  status: "planned" | "cooked" | "skipped";
  logged_to_health: boolean;
  cooked_at: string | null;
  recipes?: Recipe | null;
}

export interface ParsedReceiptItem {
  raw_name: string;
  name: string;
  category: string;
  quantity: number;
  unit: string | null;
  price: number | null;
  purchase_date: string;
  estimated_expiry: string;
  /** Server-matched USDA nutrition (per 100 g); absent when no confident match. */
  nutrition?: ItemNutrition;
}

/** Mirrors server/src/domain/schemas.ts ItemNutrition. */
export interface ItemNutrition {
  fdc_id: number;
  item_name: string;
  confidence: number;
  /** true when confidence < 0.7 (server NUTRITION_REVIEW_THRESHOLD): ask the user to confirm. */
  needs_review: boolean;
  category: string;
  calories_kcal_100g: number | null;
  protein_g_100g: number | null;
  carbs_g_100g: number | null;
  fat_g_100g: number | null;
  fiber_g_100g: number | null;
  typical_package_size_g: number;
}

export interface ParsedReceipt {
  ocr: "perceptron" | "gemini_vision";
  store: string | null;
  purchased_at: string;
  total: number | null;
  items: ParsedReceiptItem[];
}

export const CATEGORIES = [
  "leafy_greens", "berries", "fresh_fruit", "fresh_vegetables", "root_vegetables", "herbs",
  "raw_poultry", "raw_meat", "raw_seafood", "deli_meat", "dairy_milk", "dairy_cheese",
  "yogurt", "eggs", "tofu", "bread", "tortillas", "cooked_leftovers", "frozen", "canned",
  "dry_goods", "condiments", "snacks", "beverages", "other",
] as const;

export const ALLERGENS = [
  "peanut", "tree_nut", "milk", "egg", "wheat", "gluten", "soy", "fish", "shellfish", "sesame",
] as const;

export const DIETS = ["omnivore", "vegetarian", "vegan", "pescatarian", "keto", "halal", "kosher"] as const;

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealName = (typeof MEALS)[number];

export type FoodSource = "photo" | "label" | "describe" | "barcode" | "search" | "quick" | "recipe" | "copy";

/** One row of public.food_log. Macros are for ONE serving; multiply by `servings` for the total. */
export interface FoodLogEntry {
  id: string;
  eaten_on: string;
  eaten_at: string;
  meal: MealName;
  name: string;
  brand: string | null;
  servings: number;
  serving_desc: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  source: FoodSource;
  barcode: string | null;
  meal_slot_id: string | null;
  logged_to_health: boolean;
}

export interface ShoppingListItem {
  id: string;
  name: string;
  quantity: string | null;
  category: string;
  checked: boolean;
  source: "manual" | "scan" | "suggestion" | "chef";
  created_at: string;
}
