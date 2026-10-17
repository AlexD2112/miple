import assert from "node:assert/strict";
import { test } from "node:test";
import { findAllergens, violatesAllergies } from "./allergens.js";

test("matches plurals but not unrelated words", () => {
  assert.deepEqual(findAllergens(["2 eggs, scrambled"], ["egg"]), ["egg"]);
  assert.deepEqual(findAllergens(["roasted eggplant"], ["egg"]), []);
  assert.deepEqual(findAllergens(["Peanuts, crushed"], ["peanut"]), ["peanut"]);
});

test("catches hidden sources", () => {
  assert.deepEqual(findAllergens(["1 tbsp soy sauce"], ["gluten"]), ["gluten"]);
  assert.deepEqual(findAllergens(["drizzle of tahini"], ["sesame"]), ["sesame"]);
  assert.deepEqual(findAllergens(["basil pesto"], ["tree_nut"]), ["tree_nut"]);
});

test("rejects recipes the model admits contain an allergen", () => {
  const recipe = { title: "Green bowl", ingredients: [{ name: "spinach" }], declared_allergens: ["milk"] };
  assert.equal(violatesAllergies(recipe, ["milk"]), true);
});

test("rejects recipes whose steps mention an allergen", () => {
  const recipe = {
    title: "Chicken & spinach bowl",
    ingredients: [{ name: "chicken breast" }, { name: "spinach" }],
    steps: ["Finish with a knob of butter."],
  };
  assert.equal(violatesAllergies(recipe, ["milk"]), true);
  assert.equal(violatesAllergies(recipe, ["shellfish"]), false);
});

test("unknown allergies match literally", () => {
  assert.deepEqual(findAllergens(["fresh mango salsa"], ["mango"]), ["mango"]);
});
