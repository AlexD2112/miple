import { z } from "zod";
import { env } from "../env.js";
import { structured } from "../lib/gemini.js";
import type { Conflicts } from "./dietary.js";

/**
 * A second, small Gemini call that runs at the same time as the chef. It only checks the user's
 * request against their profile, so it can catch hidden ingredients the keyword lists miss
 * ("pad see ew" means soy sauce). It finishes before the chef does, so it adds no waiting, and
 * if it fails or runs late the chef reply still goes out with the code-based checks.
 */

const Review = z.object({
  verdict: z.enum(["clear", "conflict"]).describe("clear when nothing in the message conflicts with the profile"),
  conflicts: z.array(
    z.object({
      kind: z.enum(["allergy", "diet", "dislike"]),
      profile_entry: z.string().describe("copied exactly from the profile's allergies or dislikes, or the diet name"),
      food: z.string().describe("the food in the request that causes the conflict, e.g. 'soy sauce'"),
      likelihood: z
        .enum(["certain", "likely", "possible"])
        .describe("certain: named outright; likely: standard in this dish; possible: only in some versions"),
    }),
  ),
});
type Review = z.infer<typeof Review>;

const SYSTEM = `You check one message to a cooking assistant against the user's food profile.
List every food the message names or clearly implies that conflicts with an allergy, the diet, or a dislike,
including the usual hidden ingredients of a dish (pad thai: fish sauce and peanuts; pesto: pine nuts and cheese;
teriyaki: soy sauce and wheat). For profile_entry, copy the allergy or dislike exactly as written in the profile,
or the diet name. Rate each conflict's likelihood honestly.
If nothing conflicts, or the message is not about food, set verdict to "clear" and return no conflicts.
Never list an entry just to say it is fine, absent, or safe.`;

export interface SafetyProfile {
  allergies: string[];
  dislikes: string[];
  diet: string;
}

const UNRESTRICTED_DIETS = new Set(["", "omnivore", "none", "any"]);

export const hasRestrictions = (p: SafetyProfile) =>
  p.allergies.length > 0 || p.dislikes.length > 0 || !UNRESTRICTED_DIETS.has(p.diet.trim().toLowerCase());

type Ask = (text: string, profile: SafetyProfile) => Promise<Review>;

/** Food text that describes an absence rather than an ingredient: "none", "peanut-free", "without soy", "no dairy". */
const ALL_CLEAR = /^\s*(none|n\/?a|nothing|no conflicts?|not applicable|safe|ok(ay)?)\s*$|\b(free|without|no)\b/i;

const askGemini: Ask = (text, profile) =>
  structured(Review, {
    system: SYSTEM,
    content: JSON.stringify({ profile: { allergies: profile.allergies, dislikes: profile.dislikes, diet: profile.diet }, message: text }),
    model: env.safetyModel,
    maxOutputTokens: 1024,
  });

/**
 * Conflicts the reviewer found, keeping only entries that really are on the profile, or null when
 * there is nothing to check, the call fails, or it takes longer than `timeoutMs`.
 */
export async function reviewRequest(
  text: string,
  profile: SafetyProfile,
  { ask = askGemini, timeoutMs = 8000 }: { ask?: Ask; timeoutMs?: number } = {},
): Promise<Conflicts | null> {
  if (!text.trim() || !hasRestrictions(profile)) return null;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const review = await Promise.race([ask(text, profile), timeout]);
    // A clean review adds nothing: no reminder, no merge.
    if (!review || review.verdict === "clear") return null;
    const allergies = new Map(profile.allergies.map((a) => [a.toLowerCase(), a]));
    const dislikes = new Map(profile.dislikes.map((d) => [d.toLowerCase(), d]));
    const out: Conflicts = { allergies: [], dislikes: [], diet: [] };
    for (const c of review.conflicts) {
      // Only fold in real findings: skip "might be in some versions" and entries that read as an all-clear.
      if (c.likelihood === "possible" || ALL_CLEAR.test(c.food)) continue;
      const entry = c.profile_entry.trim().toLowerCase();
      if (c.kind === "allergy" && allergies.has(entry)) out.allergies.push(allergies.get(entry)!);
      if (c.kind === "dislike" && dislikes.has(entry)) out.dislikes.push(dislikes.get(entry)!);
      if (c.kind === "diet" && entry === profile.diet.trim().toLowerCase() && c.food.trim()) out.diet.push(c.food.trim().toLowerCase());
    }
    return out.allergies.length + out.dislikes.length + out.diet.length > 0 ? out : null;
  } catch (err) {
    console.warn("[safety] review failed; using code checks only", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Union of two conflict lists, without duplicates. */
export function mergeConflicts(a: Conflicts, b: Conflicts | null): Conflicts {
  if (!b) return a;
  const merge = (x: string[], y: string[]) => [...new Set([...x, ...y])];
  // Keyword checks name diet conflicts by group ("poultry"); the reviewer names the food ("chicken").
  // Prefer the groups when both found something so the reminder doesn't say both.
  return {
    allergies: merge(a.allergies, b.allergies),
    dislikes: merge(a.dislikes, b.dislikes),
    diet: a.diet.length ? a.diet : merge([], b.diet),
  };
}
