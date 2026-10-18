import AsyncStorage from "@react-native-async-storage/async-storage";
import { weightTrend, type WeightEntry } from "./health";
import type { Profile } from "./types";

/**
 * MacroFactor-style adaptive targets.
 *
 * Expenditure is not guessed from a formula: it is measured from what you ate and what
 * your weight trend did. Energy balance says
 *   expenditure ≈ average intake − (trend change in lb/day × 3500 kcal/lb).
 * The calorie target is then expenditure plus the daily surplus/deficit needed to move
 * toward the goal weight at the chosen weekly rate.
 *
 * Weight and goal stay on the phone. Only the resulting four targets are saved to the
 * profile, which is what the planner and Gemini already use.
 */

export interface WeightGoal {
  goalLb: number | null;
  /** lb per week; always positive, direction comes from goal vs current. */
  ratePerWeek: number;
  /** When on, daily targets follow the recommendation instead of being typed in. */
  auto: boolean;
}

const GOAL_KEY = "miple.weightGoal.v1";
const KCAL_PER_LB = 3500;

export async function loadGoal(): Promise<WeightGoal> {
  try {
    const raw = await AsyncStorage.getItem(GOAL_KEY);
    if (raw) return { auto: false, ...(JSON.parse(raw) as Partial<WeightGoal>) } as WeightGoal;
  } catch {}
  return { goalLb: null, ratePerWeek: 0.5, auto: false };
}

export async function saveGoal(goal: WeightGoal): Promise<void> {
  await AsyncStorage.setItem(GOAL_KEY, JSON.stringify(goal));
}

export interface Recommendation {
  currentLb: number | null;
  trendLbPerWeek: number | null;
  expenditure: number;
  expenditureSource: "measured" | "estimated";
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  direction: "lose" | "gain" | "maintain";
  /** One line explaining the numbers, shown in the app. */
  reason: string;
}

const round10 = (n: number) => Math.round(n / 10) * 10;
const DAY_MS = 86_400_000;

export function recommend(
  profile: Profile,
  weights: WeightEntry[],
  intake: { date: string; kcal: number }[],
  goal: WeightGoal,
): Recommendation {
  const trend = weightTrend(weights);
  const currentLb = trend.length ? trend[trend.length - 1] : null;

  // Trend slope over the window (needs at least a week of weigh-ins).
  let slopePerDay: number | null = null;
  if (weights.length >= 3) {
    const spanDays = (new Date(weights[weights.length - 1].date).getTime() - new Date(weights[0].date).getTime()) / DAY_MS;
    if (spanDays >= 7) slopePerDay = (trend[trend.length - 1] - trend[0]) / spanDays;
  }

  const avgIntake = intake.length >= 7 ? intake.reduce((a, d) => a + d.kcal, 0) / intake.length : null;

  let expenditure: number;
  let expenditureSource: Recommendation["expenditureSource"];
  if (slopePerDay !== null && avgIntake !== null) {
    expenditure = avgIntake - slopePerDay * KCAL_PER_LB;
    expenditureSource = "measured";
  } else if (currentLb) {
    // Not enough data yet: a typical maintenance of ~15 kcal per lb of body weight.
    expenditure = currentLb * 15;
    expenditureSource = "estimated";
  } else {
    expenditure = profile.calorie_target;
    expenditureSource = "estimated";
  }
  expenditure = Math.min(5000, Math.max(1200, expenditure));

  let direction: Recommendation["direction"] = "maintain";
  let dailyAdjust = 0;
  if (goal.goalLb && currentLb) {
    const diff = goal.goalLb - currentLb;
    if (Math.abs(diff) >= 1) {
      direction = diff < 0 ? "lose" : "gain";
      // Cap the rate at 1% of body weight per week.
      const rate = Math.min(goal.ratePerWeek, currentLb * 0.01);
      dailyAdjust = ((direction === "lose" ? -1 : 1) * rate * KCAL_PER_LB) / 7;
    }
  }

  const calories = Math.max(1200, round10(expenditure + dailyAdjust));
  const proteinBase = goal.goalLb ?? currentLb ?? profile.protein_target_g;
  const protein_g = Math.round(Math.min(260, Math.max(60, proteinBase * 0.9)));
  const fat_g = Math.round((calories * 0.27) / 9);
  const carbs_g = Math.max(50, Math.round((calories - protein_g * 4 - fat_g * 9) / 4));

  const trendLbPerWeek = slopePerDay === null ? null : slopePerDay * 7;
  const reason =
    expenditureSource === "measured"
      ? `You've averaged ${Math.round(avgIntake!)} kcal and your trend moved ${trendLbPerWeek! >= 0 ? "+" : ""}${trendLbPerWeek!.toFixed(1)} lb/week, so you burn about ${round10(expenditure)} kcal a day.`
      : currentLb
        ? "Estimated from your weight for now. Log weigh-ins for a week (and food in Apple Health) and Ripe will measure what you really burn."
        : "Log your weight to get automatic targets.";

  return { currentLb, trendLbPerWeek, expenditure: round10(expenditure), expenditureSource, calories, protein_g, carbs_g, fat_g, direction, reason };
}
