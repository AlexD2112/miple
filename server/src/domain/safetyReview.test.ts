import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
process.env.GOOGLE_CLOUD_PROJECT ??= "test-project";

const { mergeConflicts, reviewRequest } = await import("./safetyReview.js");

const profile = { allergies: ["soy", "peanut"], dislikes: ["cilantro"], diet: "vegetarian" };

test("keeps only conflicts that are really on the profile", async () => {
  const got = await reviewRequest("Can I get pad see ew with chicken?", profile, {
    ask: async () => ({
      verdict: "conflict" as const,
      conflicts: [
        { kind: "allergy" as const, profile_entry: "Soy", food: "soy sauce", likelihood: "likely" as const },
        { kind: "allergy" as const, profile_entry: "shellfish", food: "shrimp", likelihood: "certain" as const }, // not on the profile
        { kind: "diet" as const, profile_entry: "vegetarian", food: "Chicken", likelihood: "certain" as const },
        { kind: "dislike" as const, profile_entry: "olives", food: "olives", likelihood: "certain" as const }, // not on the profile
      ],
    }),
  });
  assert.deepEqual(got, { allergies: ["soy"], dislikes: [], diet: ["chicken"] });
});

test("never blocks the reply: errors and slow reviews return null", async () => {
  assert.equal(await reviewRequest("pad thai", profile, { ask: async () => { throw new Error("down"); } }), null);
  const slow = () => new Promise<never>(() => {});
  assert.equal(await reviewRequest("pad thai", profile, { ask: slow, timeoutMs: 20 }), null);
});

test("skips the call when the profile has no restrictions", async () => {
  let called = false;
  const ask = async () => { called = true; return { verdict: "clear" as const, conflicts: [] }; };
  assert.equal(await reviewRequest("anything", { allergies: [], dislikes: [], diet: "omnivore" }, { ask }), null);
  assert.equal(called, false);
});

test("merging prefers keyword diet groups over reviewer food names", () => {
  const merged = mergeConflicts(
    { allergies: ["peanut"], dislikes: [], diet: ["poultry"] },
    { allergies: ["soy", "peanut"], dislikes: ["cilantro"], diet: ["chicken"] },
  );
  assert.deepEqual(merged, { allergies: ["peanut", "soy"], dislikes: ["cilantro"], diet: ["poultry"] });
});

test("all-clear findings are not folded in", async () => {
  const clean = await reviewRequest("Caprese salad?", profile, {
    ask: async () => ({ verdict: "clear" as const, conflicts: [{ kind: "allergy" as const, profile_entry: "soy", food: "no soy here", likelihood: "certain" as const }] }),
  });
  assert.equal(clean, null);

  const noise = await reviewRequest("Peanut-free cookies?", profile, {
    ask: async () => ({
      verdict: "conflict" as const,
      conflicts: [
        { kind: "allergy" as const, profile_entry: "peanut", food: "peanut-free", likelihood: "certain" as const },
        { kind: "allergy" as const, profile_entry: "soy", food: "none", likelihood: "certain" as const },
        { kind: "allergy" as const, profile_entry: "soy", food: "soy lecithin", likelihood: "possible" as const },
      ],
    }),
  });
  assert.equal(noise, null);
});
