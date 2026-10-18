import { Platform } from "react-native";
import { supabase } from "./supabase";
import type { Macros, MealSlot, Profile, Recipe } from "./types";

/**
 * Everything Apple Health lives behind this file. The rest of the app calls
 * `getRemainingMacros()` and `logMealToHealth()` and never touches HealthKit directly,
 * so the core loop keeps working when HealthKit is unavailable.
 *
 * Uses @kingstinct/react-native-healthkit (Nitro modules), which works on the
 * New Architecture. The old react-native-health module never registered there.
 *
 * Privacy rule: raw samples stay on the device. Only the four remaining-macro numbers
 * are ever sent to the server / LLM.
 */

type HK = typeof import("@kingstinct/react-native-healthkit");

// Loaded lazily so a missing native module can't crash the app at import time.
let hkCache: HK | null | undefined;

/** Why the last Health call failed, shown to the user so problems are visible without logs. */
export let lastHealthError: string | null = null;
function fail(where: string, err: unknown) {
  lastHealthError = `${where}: ${err instanceof Error ? err.message : String(err)}`;
  console.warn("[health]", lastHealthError);
}

function healthKit(): HK | null {
  if (hkCache !== undefined) return hkCache;
  hkCache = null;
  if (Platform.OS !== "ios") {
    lastHealthError = "Apple Health is only available on iOS.";
    return null;
  }
  try {
    const mod = require("@kingstinct/react-native-healthkit") as HK;
    if (mod.isHealthDataAvailable()) hkCache = mod;
    else lastHealthError = "HealthKit reports it is not available on this device.";
  } catch (err) {
    fail("loading the HealthKit module", err);
  }
  return hkCache;
}

export const isHealthKitSupported = () => healthKit() !== null;

const ENERGY = "HKQuantityTypeIdentifierDietaryEnergyConsumed" as const;
const PROTEIN = "HKQuantityTypeIdentifierDietaryProtein" as const;
const CARBS = "HKQuantityTypeIdentifierDietaryCarbohydrates" as const;
const FAT = "HKQuantityTypeIdentifierDietaryFatTotal" as const;
const FIBER = "HKQuantityTypeIdentifierDietaryFiber" as const;
const ACTIVE = "HKQuantityTypeIdentifierActiveEnergyBurned" as const;

let initialized = false;

export async function requestHealthPermissions(): Promise<boolean> {
  const hk = healthKit();
  if (!hk) return false;
  try {
    await hk.requestAuthorization({
      toRead: [ENERGY, PROTEIN, CARBS, FAT, FIBER, ACTIVE, "HKQuantityTypeIdentifierBodyMass"],
      toShare: [ENERGY, PROTEIN, CARBS, FAT],
    });
    initialized = true;
    lastHealthError = null;
    return true;
  } catch (err) {
    fail("requesting permission", err);
    return false;
  }
}

type SumIdentifier = typeof ENERGY | typeof PROTEIN | typeof CARBS | typeof FAT | typeof FIBER | typeof ACTIVE;

/** Total for today (midnight to now). Returns 0 on any error or when there is no data. */
async function sumToday(hk: HK, identifier: SumIdentifier, unit: "kcal" | "g"): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  try {
    const res = await hk.queryStatisticsForQuantity(identifier, ["cumulativeSum"], {
      filter: { date: { startDate: start, endDate: new Date() } },
      unit,
    } as never);
    return res.sumQuantity?.quantity ?? 0;
  } catch (err) {
    fail(`reading ${identifier.replace("HKQuantityTypeIdentifier", "")}`, err);
    return 0;
  }
}

export interface MacroStatus {
  source: "healthkit" | "manual";
  target: Macros;
  consumed: Macros;
  remaining: Macros;
  activeEnergyBurned: number;
  /** Consumed fiber in grams. Set only when today's numbers come from Apple Health. */
  fiber_g?: number;
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
  let fiber_g: number | undefined;

  const hk = healthKit();
  if (profile.healthkit_enabled && hk) {
    try {
      if (!initialized) await requestHealthPermissions();
      const [calories, protein, carbs, fat, fiber, active] = await Promise.all([
        sumToday(hk, ENERGY, "kcal"),
        sumToday(hk, PROTEIN, "g"),
        sumToday(hk, CARBS, "g"),
        sumToday(hk, FAT, "g"),
        sumToday(hk, FIBER, "g"),
        sumToday(hk, ACTIVE, "kcal"),
      ]);
      consumed = { calories, protein_g: protein, carbs_g: carbs, fat_g: fat };
      activeEnergyBurned = active;
      fiber_g = fiber;
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
  return { source, target, consumed, remaining, activeEnergyBurned, fiber_g };
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

/** Writes one serving of a cooked Miple meal to Apple Health as a food correlation. */
export async function logMealToHealth(recipe: Recipe, at = new Date()): Promise<boolean> {
  const hk = healthKit();
  if (!hk) return false;
  if (!initialized && !(await requestHealthPermissions())) return false;

  const sample = (quantityType: SumIdentifier, unit: "kcal" | "g", quantity: number) => ({
    quantityType,
    unit,
    quantity: Math.max(0, Number(quantity) || 0),
    startDate: at,
    endDate: at,
  });
  try {
    await hk.saveCorrelationSample(
      "HKCorrelationTypeIdentifierFood",
      [
        sample(ENERGY, "kcal", recipe.calories),
        sample(PROTEIN, "g", recipe.protein_g),
        sample(CARBS, "g", recipe.carbs_g),
        sample(FAT, "g", recipe.fat_g),
      ] as never,
      at,
      at,
      { HKFoodType: recipe.title } as never,
    );
    return true;
  } catch (err) {
    fail("saving a meal", err);
    return false;
  }
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