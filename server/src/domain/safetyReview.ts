import { z } from "zod";
import { env } from "../env.js";
import { structured } from "../lib/gemini.js";
import { ALLERGEN_KEYWORDS, normalizeForMatch } from "./allergens.js";
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

/** A food field that isn't a food at all: the model saying there's nothing to report. */
const NON_ANSWER = /^\s*(none|n\/?a|nothing|no conflicts?|not applicable|safe|ok(ay)?)\s*$/i;

/** Extra words people use for an allergen in "X-free" labels ("dairy-free" for a milk allergy). */
const ALLERGEN_SYNONYMS: Record<string, string[]> = {
  milk: ["dairy", "lactose"],
  egg: ["eggs"],
  peanut: ["peanuts"],
  tree_nut: ["nut", "nuts", "tree nut", "tree nuts"],
  wheat: ["gluten"],
  gluten: ["wheat"],
  soy: ["soya"],
  shellfish: ["crustacean", "seafood"],
};

/** Words that make a diet finding an all-clear ("meat-free chili" for a vegetarian). */
const DIET_FREE_WORDS = ["meat", "animal", "dairy", "egg", "fish", "pork", "alcohol"];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when the finding's own food text says the conflict is absent: "dairy-free cheese" clears a
 * milk finding, but "soy-free cheese" does not, and neither does "no-bake cheesecake". Absence
 * wording about some other allergen never clears the finding.
 */
function clearsItself(kind: "allergy" | "diet" | "dislike", entry: string, food: string): boolean {
  const text = normalizeForMatch(food);
  if (NON_ANSWER.test(text)) return true;
  const terms =
    kind === "allergy"
      ? [entry, ...(ALLERGEN_SYNONYMS[entry] ?? []), ...(ALLERGEN_KEYWORDS[entry] ?? [])]
      : kind === "dislike"
        ? [entry]
        : DIET_FREE_WORDS;
  const alt = terms.map((t) => escapeRe(normalizeForMatch(t))).join("|");
  // "<allergen>-free" (but not "not <allergen>-free"), "no <allergen>", "without <allergen>", "free of <allergen>".
  const absence = new RegExp(
    `(?<!\\bnot\\s)\\b(?:${alt})(?:e?s)?[\\s-]*free\\b|\\b(?:no|without|free of)\\s+(?:${alt})(?:e?s)?\\b`,
    "i",
  );
  return absence.test(text);
}

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
    if (!review) return null;
    // A "clear" verdict with no findings adds nothing. If the model says "clear" but still lists a
    // concrete conflict, the findings win: being cautious is the safer way to resolve a contradiction.
    const allergies = new Map(profile.allergies.map((a) => [a.toLowerCase(), a]));
    const dislikes = new Map(profile.dislikes.map((d) => [d.toLowerCase(), d]));
    const out: Conflicts = { allergies: [], dislikes: [], diet: [] };
    for (const c of review.conflicts) {
      const entry = c.profile_entry.trim().toLowerCase();
      // Only fold in real findings: skip "might be in some versions" and findings whose own text
      // says this allergen, diet item or dislike is absent.
      if (c.likelihood === "possible" || clearsItself(c.kind, entry, c.food)) continue;
      if (c.kind === "allergy" && allergies.has(entry)) out.allergies.push(allergies.get(entry)!);
      if (c.kind === "dislike" && dislikes.has(entry)) out.dislikes.push(dislikes.get(entry)!);
      if (c.kind === "diet" && entry === profile.diet.trim().toLowerCase() && c.food.trim()) out.diet.push(c.food.trim().toLowerCase());
    }
    const unique = { allergies: [...new Set(out.allergies)], dislikes: [...new Set(out.dislikes)], diet: [...new Set(out.diet)] };
    return unique.allergies.length + unique.dislikes.length + unique.diet.length > 0 ? unique : null;
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
