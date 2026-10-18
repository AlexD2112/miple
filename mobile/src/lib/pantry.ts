import { addDaysIso } from "./dates";
import { currentUserId, supabase } from "./supabase";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export interface ShelfLife {
  name: string;
  category: string;
  storage: "fridge" | "freezer" | "pantry" | "counter";
  days: number;
  tip: string;
  source: "gemini" | "table";
}

/** Asks the server (Gemini) how long a food keeps. Returns null when the server can't be reached. */
export async function estimateShelfLife(name: string): Promise<ShelfLife | null> {
  if (!API_URL) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch(`${API_URL}/items/shelf-life`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ShelfLife;
  } catch {
    return null;
  }
}

// Used when the server can't be reached, so "Auto" still gives a sensible answer.
const DAYS: Record<string, number> = {
  leafy_greens: 5, berries: 4, fresh_fruit: 7, fresh_vegetables: 7, root_vegetables: 21, herbs: 5,
  raw_poultry: 2, raw_meat: 3, raw_seafood: 2, deli_meat: 5, dairy_milk: 7, dairy_cheese: 21, yogurt: 14,
  eggs: 28, tofu: 7, bread: 5, tortillas: 14, cooked_leftovers: 4, frozen: 90, canned: 365, dry_goods: 180,
  condiments: 90, snacks: 60, beverages: 30, other: 7,
};
const KEYWORDS: [string, RegExp][] = [
  ["frozen", /frozen/],
  ["canned", /\bcan(ned)?\b|canned/],
  ["leafy_greens", /spinach|lettuce|kale|arugula|chard|greens|romaine|cabbage|bok choy/],
  ["berries", /berr/],
  ["herbs", /cilantro|parsley|basil|mint|dill|thyme|rosemary|herb/],
  ["root_vegetables", /potato|carrot|onion|garlic|beet|turnip|radish|yam|ginger/],
  ["fresh_fruit", /apple|banana|orange|lemon|lime|grape|mango|pear|peach|plum|melon|pineapple|kiwi|avocado|cherr/],
  ["fresh_vegetables", /tomato|pepper|cucumber|broccoli|cauliflower|zucchini|squash|mushroom|celery|corn|asparagus|green bean|eggplant|\bpeas?\b/],
  ["raw_poultry", /chicken|turkey|duck/],
  ["raw_seafood", /fish|salmon|tuna|shrimp|cod|tilapia|crab|scallop/],
  ["deli_meat", /deli|ham|salami|bologna|prosciutto|pepperoni/],
  ["raw_meat", /beef|pork|steak|lamb|ground|sausage|bacon/],
  ["condiments", /peanut butter|almond butter|nut butter/],
  ["yogurt", /yogh?urt/],
  ["dairy_cheese", /cheese|parmesan|mozzarella|cheddar|feta/],
  ["dairy_milk", /milk|cream|half and half|butter/],
  ["eggs", /\beggs?\b/],
  ["tofu", /tofu|tempeh/],
  ["tortillas", /tortilla|wrap|pita/],
  ["bread", /bread|bagel|bun|roll|baguette|croissant/],
  ["cooked_leftovers", /leftover|cooked|takeout/],
  ["condiments", /sauce|ketchup|mustard|mayo|dressing|salsa|jam|honey|oil|vinegar/],
  ["dry_goods", /rice|pasta|flour|sugar|oats|cereal|beans|lentil|quinoa/],
  ["snacks", /chips|cracker|cookie|granola|nuts|bar\b/],
  ["beverages", /juice|soda|drink|coffee|tea|beer|wine|water/],
];

function guessShelfLife(name: string, category?: string): ShelfLife {
  const n = name.toLowerCase();
  const cat = category ?? KEYWORDS.find(([, re]) => re.test(n))?.[0] ?? "other";
  const storage = ["frozen"].includes(cat) ? "freezer" : ["canned", "dry_goods", "snacks", "root_vegetables"].includes(cat) ? "pantry" : "fridge";
  return { name, category: cat, storage, days: DAYS[cat] ?? 7, tip: "", source: "table" };
}

/**
 * Adds a manually entered pantry item. Gemini estimates the shelf life (and the category,
 * unless the user picked one). If the server is unreachable, the database fills the expiry
 * from the category's default shelf life instead, so adding never fails because of AI.
 */
export async function addPantryItem(input: {
  name: string;
  category?: string; // user's explicit choice; omit to let Gemini decide
  quantity?: number;
  price?: number;
}): Promise<{ error: string | null; estimate: ShelfLife }> {
  const name = input.name.trim();
  const estimate = (await estimateShelfLife(name)) ?? guessShelfLife(name, input.category);
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const { error } = await supabase.from("items").insert({
    user_id: await currentUserId(),
    name,
    category: input.category ?? estimate.category,
    source: "manual",
    ...(input.quantity && input.quantity > 0 ? { quantity: input.quantity } : {}),
    ...(input.price != null && input.price >= 0 ? { price: input.price } : {}),
    estimated_expiry: addDaysIso(todayIso, estimate.days),
  });
  return { error: error?.message ?? null, estimate };
}

/** "Lasts about 5 days in the fridge." */
export function describeShelfLife(e: ShelfLife): string {
  const span = e.days >= 60 ? `${Math.round(e.days / 30)} months` : e.days >= 14 ? `${Math.round(e.days / 7)} weeks` : `${e.days} day${e.days === 1 ? "" : "s"}`;
  return `Lasts about ${span} ${e.storage === "counter" ? "on the counter" : `in the ${e.storage}`}.${e.tip ? ` ${e.tip}` : ""}`;
}
