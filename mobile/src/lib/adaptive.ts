import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDailyIntake, getWeightHistory, weightTrend, type WeightEntry } from "./health";
import type { Profile } from "./types";

/**
 * MacroFactor-style adaptive targets.
 *
 * Expenditure is not guessed from a formula: it is measured from what you ate and what
 * your weight trend did. Energy balance says
 *   expenditure ≈ average intake − (trend change in lb/day × 3500 kcal/lb).
 * The calorie target is then expenditure plus the daily surplus or deficit for the chosen
 * mode (lose, maintain or bulk) at the chosen weekly rate.
 *
 * Weight and goal stay on the phone. Only the resulting four targets are saved to the
 * profile, which is what the planner and Gemini already use.
 */

export type GoalMode = "lose" | "maintain" | "bulk";

export interface WeightGoal {
  /** What the user is going for. Older saved goals have no mode; see `modeOf`. */
  mode?: GoalMode;
  /** Optional target weight. Reaching it switches the targets to maintenance. */
  goalLb: number | null;
  /** lb per week; always positive, direction comes from the mode. */
  ratePerWeek: number;
  /** When on, daily targets follow the recommendation instead of being typed in. */
  auto: boolean;
}

const GOAL_KEY = "miple.weightGoal.v1";
const KCAL_PER_LB = 3500;
const DAY_MS = 86_400_000;
/** The smoothed trend needs about a week of weigh-ins before it is better than the latest reading. */
const TREND_MIN_DAYS = 7;

// No mode until the user picks one or enters a goal weight; `modeOf` then infers it (see below).
export const DEFAULT_GOAL: WeightGoal = { goalLb: null, ratePerWeek: 0.5, auto: false };

export async function loadGoal(): Promise<WeightGoal> {
  try {
    const raw = await AsyncStorage.getItem(GOAL_KEY);
    if (raw) return { ...DEFAULT_GOAL, ...(JSON.parse(raw) as Partial<WeightGoal>) };
  } catch {}
  return DEFAULT_GOAL;
}

export async function saveGoal(goal: WeightGoal): Promise<void> {
  await AsyncStorage.setItem(GOAL_KEY, JSON.stringify(goal));
}

/** Goals saved before modes existed: a goal weight below or above today's means lose or bulk. */
export function modeOf(goal: WeightGoal, currentLb: number | null): GoalMode {
  if (goal.mode) return goal.mode;
  if (goal.goalLb && currentLb && Math.abs(goal.goalLb - currentLb) >= 1) return goal.goalLb < currentLb ? "lose" : "bulk";
  return "maintain";
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

/** Today's body weight: the smoothed trend once there is a week of weigh-ins, the latest reading before that. */
export function currentWeight(weights: WeightEntry[]): number | null {
  if (weights.length === 0) return null;
  const spanDays = (new Date(weights[weights.length - 1].date).getTime() - new Date(weights[0].date).getTime()) / DAY_MS;
  if (weights.length < 3 || spanDays < TREND_MIN_DAYS) return weights[weights.length - 1].lb;
  const trend = weightTrend(weights);
  return trend[trend.length - 1];
}

/** Weekly pace actually used: the chosen rate, capped at 1% of body weight when cutting and 0.5% when bulking. */
function paceFor(mode: GoalMode, ratePerWeek: number, currentLb: number): number {
  if (mode === "maintain") return 0;
  return Math.min(ratePerWeek, currentLb * (mode === "lose" ? 0.01 : 0.005));
}

export function recommend(
  profile: Profile,
  weights: WeightEntry[],
  intake: { date: string; kcal: number }[],
  goal: WeightGoal,
): Recommendation {
  const trend = weightTrend(weights);
  const currentLb = currentWeight(weights);

  // Trend slope over the window (needs at least a week of weigh-ins).
  let slopePerDay: number | null = null;
  if (weights.length >= 3) {
    const spanDays = (new Date(weights[weights.length - 1].date).getTime() - new Date(weights[0].date).getTime()) / DAY_MS;
    if (spanDays >= TREND_MIN_DAYS) slopePerDay = (trend[trend.length - 1] - trend[0]) / spanDays;
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

  let mode = modeOf(goal, currentLb);
  // A reached goal weight means maintaining it.
  if (goal.goalLb && currentLb) {
    if (mode === "lose" && currentLb <= goal.goalLb) mode = "maintain";
    if (mode === "bulk" && currentLb >= goal.goalLb) mode = "maintain";
  }

  const pace = currentLb ? paceFor(mode, goal.ratePerWeek, currentLb) : 0;
  const dailyAdjust = ((mode === "lose" ? -1 : 1) * pace * KCAL_PER_LB) / 7;

  const calories = Math.max(1200, round10(expenditure + dailyAdjust));
  // Protein per lb of current body weight, highest when cutting to keep muscle.
  const proteinPerLb = mode === "lose" ? 1.0 : mode === "bulk" ? 0.9 : 0.8;
  const protein_g = currentLb
    ? Math.round(Math.min(260, Math.max(60, currentLb * proteinPerLb)))
    : profile.protein_target_g;
  const fat_g = Math.round((calories * (mode === "bulk" ? 0.25 : 0.28)) / 9);
  const carbs_g = Math.max(50, Math.round((calories - protein_g * 4 - fat_g * 9) / 4));

  const trendLbPerWeek = slopePerDay === null ? null : slopePerDay * 7;
  const direction: Recommendation["direction"] = mode === "bulk" ? "gain" : mode;
  const measured =
    expenditureSource === "measured"
      ? `Measured from ${Math.round(avgIntake!)} kcal a day eaten and a ${trendLbPerWeek! >= 0 ? "+" : ""}${trendLbPerWeek!.toFixed(1)} lb/week trend.`
      : currentLb
        ? "That's an estimate from your weight. Log your food and weigh-ins for a week and Ripe will measure it."
        : "Log your weight to get automatic targets.";
  const plan =
    pace > 0
      ? ` Eating ${Math.abs(round10(dailyAdjust))} kcal ${mode === "lose" ? "under that should lose" : "over that should add"} about ${Number(pace.toFixed(2))} lb a week.`
      : "";

  return {
    currentLb,
    trendLbPerWeek,
    expenditure: round10(expenditure),
    expenditureSource,
    calories,
    protein_g,
    carbs_g,
    fat_g,
    direction,
    reason: measured + plan,
  };
}

/**
 * Recomputes the targets and saves them when Auto is on. Call it after any weigh-in or goal
 * change so the targets follow the user's weight without opening the Me tab.
 */
export async function syncAutoTargets(
  profile: Profile,
  save: (patch: Partial<Profile>) => Promise<void>,
): Promise<Recommendation | null> {
  const goal = await loadGoal();
  if (!goal.auto) return null;
  const [weights, intake] = await Promise.all([getWeightHistory(profile, 30), getDailyIntake(profile, 21)]);
  const rec = recommend(profile, weights, intake, goal);
  if (!rec.currentLb) return rec;
  const changed =
    rec.calories !== profile.calorie_target ||
    rec.protein_g !== profile.protein_target_g ||
    rec.carbs_g !== profile.carbs_target_g ||
    rec.fat_g !== profile.fat_target_g;
  if (changed) {
    await save({ calorie_target: rec.calories, protein_target_g: rec.protein_g, carbs_target_g: rec.carbs_g, fat_target_g: rec.fat_g });
  }
  return rec;
}
