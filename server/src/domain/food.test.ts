import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanEstimate, cleanList, fromOpenFoodFacts, normalizeBarcode } from "./food.js";
import { searchNutrition } from "./nutrition.js";

const item = (over: Partial<Parameters<typeof cleanEstimate>[0]> = {}) => ({
  name: "white rice",
  portion: "1 cup",
  grams: 158,
  calories: 205,
  protein_g: 4.3,
  carbs_g: 44.5,
  fat_g: 0.4,
  fiber_g: 0.6,
  confidence: 0.8,
  ...over,
});

test("keeps a consistent estimate as is", () => {
  const out = cleanEstimate(item());
  assert.equal(out.calories, 205);
  assert.equal(out.adjusted, undefined);
});

test("recomputes calories that disagree with the macros", () => {
  // 30 g protein, 0 carbs, 10 g fat = 210 kcal, not 600.
  const out = cleanEstimate(item({ calories: 600, protein_g: 30, carbs_g: 0, fat_g: 10, fiber_g: null }));
  assert.equal(out.calories, 210);
  assert.equal(out.adjusted, true);
});

test("clamps negatives and impossible values", () => {
  const out = cleanEstimate(item({ calories: -50, protein_g: -3, carbs_g: 5, fat_g: 0, fiber_g: 40, grams: -10, confidence: 4 }));
  assert.equal(out.protein_g, 0);
  assert.equal(out.fiber_g, 5, "fiber can't exceed carbs");
  assert.equal(out.grams, null);
  assert.equal(out.confidence, 1);
  assert.ok(out.calories >= 0);
});

test("small items aren't recomputed (black coffee)", () => {
  const out = cleanEstimate(item({ name: "black coffee", calories: 2, protein_g: 0.3, carbs_g: 0, fat_g: 0, fiber_g: null }));
  assert.equal(out.calories, 2);
});

test("shopping list: trims, dedupes and drops blanks", () => {
  const out = cleanList([
    { name: " Eggs ", quantity: "1 dozen", category: "eggs" },
    { name: "eggs", quantity: null, category: "eggs" },
    { name: "  ", quantity: null, category: "other" },
    { name: "paper towels", quantity: " ", category: "other" },
  ]);
  assert.deepEqual(out, [
    { name: "Eggs", quantity: "1 dozen", category: "eggs" },
    { name: "paper towels", quantity: null, category: "other" },
  ]);
});

test("barcodes: accepts UPC/EAN lengths only", () => {
  assert.equal(normalizeBarcode("0 49000 05010 3"), "049000050103");
  assert.equal(normalizeBarcode("12345"), null);
  assert.equal(normalizeBarcode("abc"), null);
});

test("Open Food Facts: per-serving numbers when printed", () => {
  const out = fromOpenFoodFacts("0123456789012", {
    product_name: "Creamy Peanut Butter",
    brands: "Jif, Smucker",
    serving_size: "2 tbsp (32 g)",
    serving_quantity: 32,
    nutriments: {
      "energy-kcal_serving": 190, proteins_serving: 7, carbohydrates_serving: 8, fat_serving: 16, fiber_serving: 2,
      "energy-kcal_100g": 594, proteins_100g: 21.9, carbohydrates_100g: 25, fat_100g: 50,
    },
  })!;
  assert.equal(out.name, "Creamy Peanut Butter");
  assert.equal(out.brand, "Jif");
  assert.deepEqual(out.per_serving, { calories: 190, protein_g: 7, carbs_g: 8, fat_g: 16, fiber_g: 2 });
  assert.equal(out.per_100g?.fiber_g, null);
});

test("Open Food Facts: derives a serving from per-100 g and reads kJ", () => {
  const out = fromOpenFoodFacts("40000000", {
    product_name: "Oat drink",
    serving_quantity: "250",
    nutriments: { "energy-kj_100g": 196, proteins_100g: 1, carbohydrates_100g: 6.6, fat_100g: 1.5 },
  })!;
  assert.equal(out.per_100g?.calories, 47);
  assert.equal(out.per_serving?.calories, 118);
  assert.equal(out.per_serving?.carbs_g, 16.5);
});

test("Open Food Facts: no nutrition means no result", () => {
  assert.equal(fromOpenFoodFacts("40000000", { product_name: "Mystery", nutriments: {} }), null);
  assert.equal(fromOpenFoodFacts("40000000", null), null);
});

test("USDA search finds common foods, best match first", () => {
  assert.equal(searchNutrition("greek yogurt")[0]?.name, "greek yogurt");
  assert.equal(searchNutrition("banana")[0]?.name, "banana");
  assert.deepEqual(searchNutrition("x"), []);
});
