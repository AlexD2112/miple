import { NativeModules, Platform } from "react-native";
import type { HealthKitPermissions, HealthValue } from "react-native-health";
import { supabase } from "./supabase";
import type { Macros, MealSlot, Profile, Recipe } from "./types";

/**
 * Everything Apple Health lives behind this file. The rest of the app calls
 * `getRemainingMacros()` and `logMealToHealth()` and never touches HealthKit directly,
 * so the core loop keeps working when HealthKit is unavailable (Android, simulator,
 * Expo Go, permission denied, or a dev account without the capability).
 *
 * Privacy rule: raw samples stay on the device. Only the four remaining-macro numbers
 * are ever sent to the server / LLM.
 */

// Loaded lazily so a missing native module (e.g. Expo Go) can't crash at import time.
function healthKit() {
  if (Platform.OS !== "ios" || !NativeModules.AppleHealthKit) return null;
  return (require("react-native-health") as typeof import("react-native-health")).default;
}

export const isHealthKitSupported = () => healthKit() !== null;

let initialized = false;

export async function requestHealthPermissions(): Promise<boolean> {
  const hk = healthKit();
  if (!hk) return false;
  const P = hk.Constants.Permissions;
  const permissions: HealthKitPermissions = {
    permissions: {
      read: [P.EnergyConsumed, P.Protein, P.Carbohydrates, P.FatTotal, P.ActiveEnergyBurned, P.Weight],
      write: [P.EnergyConsumed, P.Protein, P.Carbohydrates, P.FatTotal],
    },
  };
  return new Promise((resolve) => {
    hk.initHealthKit(permissions, (err) => {
      initialized = !err;
      if (err) console.warn("[health] init failed", err);
      resolve(!err);
    });
  });
}

type SampleReader = (opts: { startDate: string; endDate: string }, cb: (err: string, r: HealthValue[]) => void) => void;

function sumToday(reader: SampleReader | undefined, extra: Record<string, unknown> = {}): Promise<number> {
  if (!reader) return Promise.resolve(0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return new Promise((resolve) => {
    reader({ startDate: start.toISOString(), endDate: new Date().toISOString(), ...extra }, (err, results) => {
      if (err || !Array.isArray(results)) return resolve(0);
      resolve(results.reduce((acc, r) => acc + (Number(r.value) || 0), 0));
    });
  });
}

export interface MacroStatus {
  source: "healthkit" | "manual";
  target: Macros;
  consumed: Macros;
  remaining: Macros;
  activeEnergyBurned: number;
}

const zero: Macros = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

/** Remaining macros for today = target (+ workout bonus) − eaten. Never throws. */
export async function getRemainingMacros(profile: Profile): Promise<MacroStatus> {
  const base: Macros = {
    calories: profile.calorie_target,
    protein_g: profile.protein_target_g,
    carbs_g: profile.carbs_target_g,
    fat_g: profile.fat_target_g,
  };

  let source: MacroStatus["source"] = "manual";
  let consumed = zero;
  let activeEnergyBurned = 0;

  const hk = healthKit();
  if (profile.healthkit_enabled && hk) {
    try {
      if (!initialized) await requestHealthPermissions();
      const [calories, protein, carbs, fat, active] = await Promise.all([
        sumToday(hk.getEnergyConsumedSamples as SampleReader),
        sumToday(hk.getProteinSamples as SampleReader),
        sumToday(hk.getCarbohydratesSamples as SampleReader),
        sumToday(hk.getTotalFatSamples as SampleReader),
        sumToday(hk.getActiveEnergyBurned as SampleReader),
      ]);
      consumed = { calories, protein_g: protein, carbs_g: carbs, fat_g: fat };
      activeEnergyBurned = active;
      source = "healthkit";
    } catch (err) {
      console.warn("[health] read failed, using manual targets", err);
    }
  }

  // Fallback: count meals cooked in Miple today.
  if (source === "manual") consumed = await mipleMealsToday();

  const target = withWorkoutBonus(base, activeEnergyBurned);
  const remaining: Macros = {
    calories: Math.max(0, Math.round(target.calories - consumed.calories)),
    protein_g: Math.max(0, Math.round(target.protein_g - consumed.protein_g)),
    carbs_g: Math.max(0, Math.round(target.carbs_g - consumed.carbs_g)),
    fat_g: Math.max(0, Math.round(target.fat_g - consumed.fat_g)),
  };
  return { source, target, consumed, remaining, activeEnergyBurned };
}

/** Heavy workout day: eat back half of active energy above a 300 kcal baseline. */
export function withWorkoutBonus(base: Macros, activeKcal: number): Macros {
  const bonus = Math.max(0, activeKcal - 300) * 0.5;
  if (bonus === 0) return base;
  return {
    calories: Math.round(base.calories + bonus),
    protein_g: Math.round(base.protein_g + (bonus * 0.3) / 4),
    carbs_g: Math.round(base.carbs_g + (bonus * 0.5) / 4),
    fat_g: Math.round(base.fat_g + (bonus * 0.2) / 9),
  };
}

async function mipleMealsToday(): Promise<Macros> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { data } = await supabase
    .from("meal_slots")
    .select("recipes(calories, protein_g, carbs_g, fat_g)")
    .eq("status", "cooked")
    .gte("cooked_at", start.toISOString());
  return ((data ?? []) as unknown as { recipes: Macros | null }[]).reduce(
    (acc, row) => ({
      calories: acc.calories + (row.recipes?.calories ?? 0),
      protein_g: acc.protein_g + (row.recipes?.protein_g ?? 0),
      carbs_g: acc.carbs_g + (row.recipes?.carbs_g ?? 0),
      fat_g: acc.fat_g + (row.recipes?.fat_g ?? 0),
    }),
    zero,
  );
}

/** Writes one serving of a cooked Miple meal to Apple Health. */
export async function logMealToHealth(recipe: Recipe, at = new Date()): Promise<boolean> {
  const hk = healthKit();
  if (!hk) return false;
  if (!initialized && !(await requestHealthPermissions())) return false;

  const hour = at.getHours();
  const mealType = hour < 11 ? "Breakfast" : hour < 16 ? "Lunch" : "Dinner";
  const options = {
    foodName: recipe.title,
    mealType,
    date: at.toISOString(),
    energy: recipe.calories,
    protein: recipe.protein_g,
    carbohydrates: recipe.carbs_g,
    fatTotal: recipe.fat_g,
  };
  return new Promise((resolve) => {
    // saveFood's typings are narrower than what the native side accepts (see its docs/saveFood.md).
    hk.saveFood(options as never, (err) => {
      if (err) console.warn("[health] saveFood failed", err);
      resolve(!err);
    });
  });
}

/**
 * Meals marked cooked by SMS reply ("done") are cooked server-side, but only the phone can
 * write to Health. Call this when the app comes to the foreground.
 */
export async function syncCookedMealsToHealth(profile: Profile): Promise<number> {
  if (!profile.healthkit_enabled || !isHealthKitSupported()) return 0;
  const { data } = await supabase
    .from("meal_slots")
    .select("*, recipes(*)")
    .eq("status", "cooked")
    .eq("logged_to_health", false);
  let logged = 0;
  for (const slot of (data ?? []) as MealSlot[]) {
    if (!slot.recipes) continue;
    if (await logMealToHealth(slot.recipes, new Date(slot.cooked_at ?? slot.starts_at))) {
      await supabase.from("meal_slots").update({ logged_to_health: true }).eq("id", slot.id);
      logged++;
    }
  }
  return logged;
}
