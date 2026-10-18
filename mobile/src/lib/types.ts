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
