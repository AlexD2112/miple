import assert from "node:assert/strict";
import { test } from "node:test";
import { conflictReminder, dietConflicts, hasConflicts, requestConflicts, violatesDiet } from "./dietary.js";

test("diets rule out the right food groups", () => {
  assert.deepEqual(dietConflicts(["chicken tikka masala"], "vegetarian"), ["poultry"]);
  assert.deepEqual(dietConflicts(["shrimp scampi"], "pescatarian"), []);
  assert.deepEqual(dietConflicts(["cheese omelette"], "vegan"), ["dairy", "eggs"]);
  assert.deepEqual(dietConflicts(["bacon and eggs"], "halal"), ["pork"]);
  assert.deepEqual(dietConflicts(["lobster roll"], "kosher"), ["shellfish"]);
  assert.deepEqual(dietConflicts(["tofu stir fry"], "vegan"), []);
  assert.deepEqual(dietConflicts(["steak"], "omnivore"), []);
  assert.deepEqual(dietConflicts(["steak"], "my own thing"), []);
});

test("recipes that break the diet are rejected", () => {
  const recipe = { title: "Noodle stir fry", ingredients: [{ name: "rice noodles" }, { name: "chicken thigh" }] };
  assert.equal(violatesDiet(recipe, "vegetarian"), true);
  assert.equal(violatesDiet({ ...recipe, ingredients: [{ name: "rice noodles" }, { name: "tofu" }] }, "vegetarian"), false);
});

test("a conflicting request gets a reminder that names the conflict", () => {
  const profile = { allergies: ["peanut"], dislikes: ["cilantro"], diet: "vegetarian" };
  const c = requestConflicts("Can I have chicken satay with cilantro tonight?", profile);
  assert.deepEqual(c, { allergies: ["peanut"], dislikes: ["cilantro"], diet: ["poultry"] });
  assert.equal(
    conflictReminder(c, profile.diet),
    "Heads up: your profile says you're allergic to peanuts, you eat vegetarian, which rules out poultry and you don't like cilantro, so I won't include those.",
  );
  assert.equal(hasConflicts(requestConflicts("Something with the spinach?", profile)), false);
});
