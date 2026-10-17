import { generateRecipes } from "@/lib/api";
import { addMealToCalendar, findFreeMealWindows } from "@/lib/calendar";
import { daysUntil } from "@/lib/dates";
import { assignRecipes } from "@/lib/planner";
import { currentUserId, supabase } from "@/lib/supabase";
import type { Item, Macros, MealSlot, Recipe } from "@/lib/types";
import { stepText } from "@/lib/types";

const PLAN_DAYS = 3;

export function mealNotes(recipe: Recipe): string {
  return [
    `${recipe.minutes} min · ${recipe.calories} kcal · ${recipe.protein_g}g protein`,
    "",
    ...recipe.ingredients.map((i) => `• ${i.quantity} ${i.name}`),
    "",
    ...recipe.steps.map((s, n) => `${n + 1}. ${stepText(s)}`),
  ].join("\n");
}

/** Puts planned meals that are missing an event onto the device calendar. */
export async function syncMealsToCalendar(slots: MealSlot[]): Promise<void> {
  for (const slot of slots) {
    if (slot.status !== "planned" || !slot.recipes || slot.calendar_event_id) continue;
    let eventId: string | null = null;
    try {
      eventId = await addMealToCalendar(
      slot.recipes.title,
      new Date(slot.starts_at),
      new Date(slot.ends_at),
      mealNotes(slot.recipes),
    );
    } catch (err) {
      console.warn("[calendar] meal sync failed", err);
      return;
    }
    if (!eventId) return;
    await supabase.from("meal_slots").update({ calendar_event_id: eventId }).eq("id", slot.id);
    slot.calendar_event_id = eventId;
  }
}

/** Fills free lunch and dinner windows that don't already have a planned meal. */
export async function planOpenWindows(input: { remaining: Macros; target: Macros }): Promise<number> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [{ data: itemRows }, { data: slotRows }] = await Promise.all([
    supabase.from("items").select("*").eq("status", "active"),
    supabase.from("meal_slots").select("starts_at, status").gte("starts_at", since.toISOString()).eq("status", "planned"),
  ]);
  const pantry = (itemRows ?? []) as Item[];
  if (pantry.length === 0) throw new Error("Your pantry is empty. Scan a receipt first.");

  const taken = (slotRows ?? []).map((s) => new Date(s.starts_at as string).getTime());
  const windows = (await findFreeMealWindows(PLAN_DAYS)).filter(
    (w) => !taken.some((t) => Math.abs(t - w.start.getTime()) < 3 * 60 * 60 * 1000),
  );
  if (windows.length === 0) return 0;

  const { recipes } = await generateRecipes({
    pantry: pantry.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      quantity: Number(i.quantity),
      unit: i.unit,
      days_left: daysUntil(i.estimated_expiry),
    })),
    remaining: input.remaining,
    max_minutes: Math.max(...windows.map((w) => w.minutes)),
    count: Math.min(8, windows.length + 2),
  });

  const plan = assignRecipes(windows, recipes, pantry, input.remaining, input.target);
  if (plan.length === 0) return 0;

  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from("meal_slots")
    .insert(
      plan.map((p) => ({
        user_id,
        starts_at: p.window.start.toISOString(),
        ends_at: p.window.end.toISOString(),
        recipe_id: p.recipe.id,
      })),
    )
    .select("*, recipes(*)");
  if (error) throw error;
  await syncMealsToCalendar((data ?? []) as MealSlot[]);
  return plan.length;
}
