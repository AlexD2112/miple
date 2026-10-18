import { supabase } from "./supabase";
import type { Item, Profile } from "./types";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export interface BuySuggestion {
  name: string;
  category: string;
  est_price: number;
  why: string;
  pairs_with: string[];
  meals: string[];
}

/** Gemini's picks for what to buy next. Returns null when the server can't be reached or doesn't have the route yet. */
export async function suggestPurchases(count = 6): Promise<BuySuggestion[] | null> {
  if (!API_URL) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch(`${API_URL}/shopping/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ count }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { items: BuySuggestion[] }).items;
  } catch {
    return null;
  }
}

type Basic = Omit<BuySuggestion, "pairs_with"> & { gap: string; diets?: string[]; avoid?: string[] };

// Cheap, long-keeping basics grouped by the gap they fill. Used when the server is unavailable.
const BASICS: Basic[] = [
  { gap: "protein", name: "Eggs (dozen)", category: "eggs", est_price: 3.5, why: "Cheapest protein per gram; breakfast, fried rice, frittata.", meals: ["Veggie scramble", "Fried rice", "Frittata"], diets: ["omnivore", "vegetarian", "pescatarian", "keto", "halal", "kosher"], avoid: ["egg"] },
  { gap: "protein", name: "Chicken thighs", category: "raw_poultry", est_price: 6, why: "Versatile, cheap protein that works with almost any vegetable.", meals: ["Sheet-pan chicken", "Chicken stir-fry"], diets: ["omnivore", "keto", "halal"] },
  { gap: "protein", name: "Firm tofu", category: "tofu", est_price: 2.5, why: "Plant protein that soaks up any sauce.", meals: ["Tofu stir-fry", "Crispy tofu bowl"], avoid: ["soy"] },
  { gap: "protein", name: "Canned chickpeas", category: "canned", est_price: 1.2, why: "Shelf-stable protein and fiber for bowls and curries.", meals: ["Chickpea curry", "Grain bowl"] },
  { gap: "protein", name: "Greek yogurt", category: "yogurt", est_price: 4.5, why: "High-protein breakfast or sauce base.", meals: ["Yogurt bowl", "Tzatziki"], diets: ["omnivore", "vegetarian", "pescatarian", "keto", "halal", "kosher"], avoid: ["milk"] },
  { gap: "vegetable", name: "Frozen broccoli", category: "frozen", est_price: 2, why: "Never goes bad and adds a vegetable to any meal.", meals: ["Stir-fry", "Pasta with broccoli"] },
  { gap: "vegetable", name: "Bell peppers", category: "fresh_vegetables", est_price: 3, why: "Adds color and crunch to stir-fries, eggs and fajitas.", meals: ["Fajitas", "Stir-fry"] },
  { gap: "vegetable", name: "Baby spinach", category: "leafy_greens", est_price: 3, why: "Wilts into eggs, pasta and rice in seconds.", meals: ["Spinach eggs", "Pasta"] },
  { gap: "carb", name: "Rice (2 lb)", category: "dry_goods", est_price: 3, why: "Cheap filling base that keeps for months.", meals: ["Fried rice", "Rice bowls"] },
  { gap: "carb", name: "Tortillas", category: "tortillas", est_price: 3, why: "Turns leftovers into wraps and quesadillas.", meals: ["Quesadillas", "Breakfast burritos"], avoid: ["wheat", "gluten"] },
  { gap: "carb", name: "Oats", category: "dry_goods", est_price: 3.5, why: "Cheap breakfast that keeps for months.", meals: ["Overnight oats", "Oatmeal"] },
  { gap: "flavor", name: "Soy sauce", category: "condiments", est_price: 2.5, why: "One bottle makes rice, eggs and vegetables taste like a meal.", meals: ["Stir-fry", "Fried rice"], avoid: ["soy", "wheat", "gluten"] },
];

const GAP_OF: Record<string, string> = {
  eggs: "protein", raw_poultry: "protein", raw_meat: "protein", raw_seafood: "protein", tofu: "protein", deli_meat: "protein", yogurt: "protein",
  leafy_greens: "vegetable", fresh_vegetables: "vegetable", root_vegetables: "vegetable", frozen: "vegetable",
  bread: "carb", tortillas: "carb", dry_goods: "carb",
  condiments: "flavor",
};

/** Offline picks: fill whatever the pantry is missing (protein, vegetable, carb, flavor) with cheap basics. */
export function quickPicks(pantry: Pick<Item, "name" | "category">[], profile: Profile | null, count = 5): BuySuggestion[] {
  const have = new Set(pantry.map((p) => GAP_OF[p.category]).filter(Boolean));
  const names = pantry.map((p) => p.name.toLowerCase());
  const diet = profile?.diet ?? "omnivore";
  const allergies = profile?.allergies ?? [];
  const ok = (b: Basic) =>
    (!b.diets || b.diets.includes(diet) || !["vegan", "vegetarian", "pescatarian"].includes(diet)) &&
    !(b.avoid ?? []).some((a) => allergies.includes(a)) &&
    !names.some((n) => n.includes(b.name.toLowerCase().split(" ")[0].replace(/s$/, "")));
  const order = ["protein", "vegetable", "carb", "flavor"].sort((a, b) => Number(have.has(a)) - Number(have.has(b)));
  const picks: BuySuggestion[] = [];
  for (let round = 0; picks.length < count && round < 4; round++) {
    for (const gap of order) {
      const b = BASICS.filter((x) => x.gap === gap && ok(x))[round];
      if (b && picks.length < count) picks.push({ name: b.name, category: b.category, est_price: b.est_price, why: b.why, meals: b.meals, pairs_with: [] });
    }
  }
  return picks;
}
