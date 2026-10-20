import { addDaysIso, localIsoDate } from "./dates";
import { supabase, currentUserId } from "./supabase";
import type { FoodLogEntry, FoodSource, Macros, MealName, Recipe } from "./types";

/**
 * The food log: everything eaten, whether or not it was cooked from the pantry. It replaces
 * "meals cooked in Ripe" as the source of what you ate when Apple Health is off, and it feeds
 * the measured expenditure in adaptive.ts the same way MacroFactor's log does.
 */

export interface DayTotals extends Macros {
  fiber_g: number;
}

export type NewFoodEntry = Omit<FoodLogEntry, "id" | "eaten_at" | "logged_to_health" | "brand" | "barcode" | "meal_slot_id" | "fiber_g" | "serving_desc"> &
  Partial<Pick<FoodLogEntry, "eaten_at" | "brand" | "barcode" | "meal_slot_id" | "fiber_g" | "serving_desc">>;

/** Set when the last food log query failed because the table doesn't exist yet (migration 0005 not run). */
export let foodLogMissing = false;

function note(error: { code?: string; message?: string } | null) {
  if (!error) return;
  foodLogMissing = error.code === "42P01" || error.code === "PGRST205" || /food_log/.test(error.message ?? "");
  console.warn("[food log]", error.message);
}

/** The meal a time of day most likely is. */
export function mealForTime(d = new Date()): MealName {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 4 && h < 10.5) return "breakfast";
  if (h >= 10.5 && h < 14.5) return "lunch";
  if (h >= 17 && h < 21.5) return "dinner";
  return "snack";
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function entryTotals(e: Pick<FoodLogEntry, "servings" | "calories" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g">): DayTotals {
  const s = Number(e.servings) || 0;
  return {
    calories: Number(e.calories) * s,
    protein_g: Number(e.protein_g) * s,
    carbs_g: Number(e.carbs_g) * s,
    fat_g: Number(e.fat_g) * s,
    fiber_g: Number(e.fiber_g ?? 0) * s,
  };
}

export function sumTotals(list: DayTotals[]): DayTotals {
  return list.reduce(
    (a, t) => ({
      calories: a.calories + t.calories,
      protein_g: a.protein_g + t.protein_g,
      carbs_g: a.carbs_g + t.carbs_g,
      fat_g: a.fat_g + t.fat_g,
      fiber_g: a.fiber_g + t.fiber_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
  );
}

/** A cooked plan meal with no food log row (cooked by SMS reply, or before the food log existed). */
export interface CookedSlot {
  id: string;
  cooked_at: string;
  title: string;
  totals: DayTotals;
}

/** Entries for one local day, oldest first, plus cooked plan meals that aren't in the log. */
export async function loadDay(day: string): Promise<{ entries: FoodLogEntry[]; cooked: CookedSlot[] }> {
  const [entries, cooked] = await Promise.all([
    supabase.from("food_log").select("*").eq("eaten_on", day).order("eaten_at", { ascending: true }),
    cookedSlotsBetween(day, addDaysIso(day, 1)),
  ]);
  note(entries.error);
  const list = (entries.data ?? []) as FoodLogEntry[];
  const logged = new Set(list.map((e) => e.meal_slot_id).filter(Boolean));
  return { entries: list, cooked: cooked.filter((c) => !logged.has(c.id)) };
}

async function cookedSlotsBetween(fromDay: string, toDay: string): Promise<CookedSlot[]> {
  const [fy, fm, fd] = fromDay.split("-").map(Number);
  const [ty, tm, td] = toDay.split("-").map(Number);
  const { data } = await supabase
    .from("meal_slots")
    .select("id, cooked_at, starts_at, recipes(title, calories, protein_g, carbs_g, fat_g)")
    .eq("status", "cooked")
    .gte("cooked_at", new Date(fy, fm - 1, fd).toISOString())
    .lt("cooked_at", new Date(ty, tm - 1, td).toISOString());
  return ((data ?? []) as unknown as { id: string; cooked_at: string; recipes: (Macros & { title: string }) | null }[])
    .filter((s) => s.recipes)
    .map((s) => ({
      id: s.id,
      cooked_at: s.cooked_at,
      title: s.recipes!.title,
      totals: { ...entryTotals({ servings: 1, ...s.recipes!, fiber_g: null }) },
    }));
}

/** Everything eaten on a local day (log + cooked plan meals not in the log). */
export async function totalsForDay(day = localIsoDate()): Promise<{ totals: DayTotals; entries: FoodLogEntry[] }> {
  const { entries, cooked } = await loadDay(day);
  return { totals: sumTotals([...entries.map(entryTotals), ...cooked.map((c) => c.totals)]), entries };
}

/**
 * Calories eaten per day for the last `days` days, oldest first, not counting today.
 * Days with nothing logged are left out, so a forgotten day doesn't look like a fast.
 */
export async function dailyIntakeFromLog(days = 21): Promise<{ date: string; kcal: number }[]> {
  const today = localIsoDate();
  const from = addDaysIso(today, -days);
  const [rows, cooked] = await Promise.all([
    supabase.from("food_log").select("eaten_on, servings, calories, meal_slot_id").gte("eaten_on", from).lt("eaten_on", today),
    cookedSlotsBetween(from, today),
  ]);
  note(rows.error);
  const list = (rows.data ?? []) as Pick<FoodLogEntry, "eaten_on" | "servings" | "calories" | "meal_slot_id">[];
  const logged = new Set(list.map((e) => e.meal_slot_id).filter(Boolean));
  const byDay = new Map<string, number>();
  for (const e of list) byDay.set(e.eaten_on, (byDay.get(e.eaten_on) ?? 0) + Number(e.calories) * Number(e.servings));
  for (const c of cooked) {
    if (logged.has(c.id)) continue;
    const day = localIsoDate(new Date(c.cooked_at));
    byDay.set(day, (byDay.get(day) ?? 0) + c.totals.calories);
  }
  return [...byDay.entries()]
    .filter(([, kcal]) => kcal > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, kcal]) => {
      const [y, m, d] = day.split("-").map(Number);
      return { date: new Date(y, m - 1, d, 12).toISOString(), kcal };
    });
}

/** Average calories and protein over logged days in the last week, for the weekly card. */
export async function weekAverages(): Promise<{ days: number; calories: number; protein_g: number } | null> {
  const today = localIsoDate();
  const { data, error } = await supabase
    .from("food_log")
    .select("eaten_on, servings, calories, protein_g")
    .gte("eaten_on", addDaysIso(today, -7))
    .lt("eaten_on", today);
  note(error);
  const rows = (data ?? []) as Pick<FoodLogEntry, "eaten_on" | "servings" | "calories" | "protein_g">[];
  if (!rows.length) return null;
  const days = new Set(rows.map((r) => r.eaten_on)).size;
  const sum = (k: "calories" | "protein_g") => rows.reduce((a, r) => a + Number(r[k]) * Number(r.servings), 0);
  return { days, calories: Math.round(sum("calories") / days), protein_g: Math.round(sum("protein_g") / days) };
}

const MEAL_HOUR: Record<MealName, number> = { breakfast: 8, lunch: 12.5, dinner: 19, snack: 15 };

/** When an entry was eaten: now for today, otherwise a typical time for its meal on that day. */
export function defaultEatenAt(day: string, meal: MealName, now = new Date()): string {
  if (day === localIsoDate(now)) return now.toISOString();
  const [y, m, d] = day.split("-").map(Number);
  const h = MEAL_HOUR[meal];
  return new Date(y, m - 1, d, Math.floor(h), Math.round((h % 1) * 60)).toISOString();
}

/** Saves entries and returns them with ids. Apple Health logging is up to the caller (see health.ts). */
export async function addEntries(list: NewFoodEntry[]): Promise<{ data: FoodLogEntry[]; error: string | null }> {
  if (!list.length) return { data: [], error: null };
  const user_id = await currentUserId();
  const rows = list.map((e) => ({
    ...e,
    eaten_at: e.eaten_at ?? defaultEatenAt(e.eaten_on, e.meal),
    user_id,
    name: e.name.trim().slice(0, 120) || "Food",
    servings: Math.max(0.01, Number(e.servings) || 1),
    calories: Math.max(0, r1(Number(e.calories) || 0)),
    protein_g: Math.max(0, r1(Number(e.protein_g) || 0)),
    carbs_g: Math.max(0, r1(Number(e.carbs_g) || 0)),
    fat_g: Math.max(0, r1(Number(e.fat_g) || 0)),
    fiber_g: e.fiber_g == null ? null : Math.max(0, r1(Number(e.fiber_g))),
  }));
  const { data, error } = await supabase.from("food_log").insert(rows).select("*");
  note(error);
  return { data: (data ?? []) as FoodLogEntry[], error: error ? friendly(error.message) : null };
}

export async function updateEntry(id: string, patch: Partial<FoodLogEntry>): Promise<string | null> {
  const { error } = await supabase.from("food_log").update(patch).eq("id", id);
  note(error);
  return error ? friendly(error.message) : null;
}

export async function deleteEntry(id: string): Promise<string | null> {
  const { error } = await supabase.from("food_log").delete().eq("id", id);
  note(error);
  return error ? friendly(error.message) : null;
}

function friendly(message: string): string {
  return foodLogMissing ? "The food log isn't set up on the server yet. Run the 0005 database migration." : message;
}

/** Foods logged before, newest first, one per name, as templates to log again in one tap. */
export async function recentFoods(limit = 30): Promise<FoodLogEntry[]> {
  const { data, error } = await supabase
    .from("food_log")
    .select("*")
    .is("meal_slot_id", null)
    .order("eaten_at", { ascending: false })
    .limit(300);
  note(error);
  const seen = new Set<string>();
  const out: FoodLogEntry[] = [];
  for (const e of (data ?? []) as FoodLogEntry[]) {
    const key = `${e.name.toLowerCase()}|${e.brand ?? ""}|${e.calories}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** A copy of an entry for another day or meal, ready for addEntries. */
export function asNew(e: FoodLogEntry, day: string, meal: MealName, source: FoodSource = "copy"): NewFoodEntry {
  return {
    eaten_on: day,
    meal,
    name: e.name,
    brand: e.brand,
    servings: e.servings,
    serving_desc: e.serving_desc,
    calories: e.calories,
    protein_g: e.protein_g,
    carbs_g: e.carbs_g,
    fat_g: e.fat_g,
    fiber_g: e.fiber_g,
    source,
    barcode: e.barcode,
  };
}

/** One serving of a cooked Ripe recipe, linked to its plan slot so it is only ever counted once. */
export function recipeEntry(recipe: Recipe, at = new Date(), slotId: string | null = null): NewFoodEntry {
  return {
    eaten_on: localIsoDate(at),
    eaten_at: at.toISOString(),
    meal: mealForTime(at),
    name: recipe.title,
    servings: 1,
    serving_desc: "1 serving",
    calories: recipe.calories,
    protein_g: recipe.protein_g,
    carbs_g: recipe.carbs_g,
    fat_g: recipe.fat_g,
    source: "recipe",
    meal_slot_id: slotId,
  };
}
