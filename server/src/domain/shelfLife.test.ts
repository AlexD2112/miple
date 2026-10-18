import assert from "node:assert/strict";
import { test } from "node:test";
import { itemShelfLife } from "./shelfLife.js";

// [item, category, expected days or null for "fall back to the category"], from USDA FoodKeeper.
const CASES: [string, string, number | null][] = [
  ["apples", "fresh_fruit", 28],
  ["bananas", "fresh_fruit", 3],
  ["strawberries", "berries", 2],
  ["organic spinach", "leafy_greens", 3],
  ["potatoes", "root_vegetables", 30],
  ["onions", "root_vegetables", 30],
  ["broccoli", "fresh_vegetables", 3],
  ["boneless chicken breast", "raw_poultry", 1],
  ["ground beef", "raw_meat", 1],
  ["pork chops", "raw_meat", 3],
  ["salmon", "raw_seafood", 1],
  ["cheddar cheese", "dairy_cheese", 180],
  ["brie", "dairy_cheese", 7],
  ["large brown eggs", "eggs", 21],
  ["firm tofu", "tofu", 7],
  ["rice", "dry_goods", 730],
  // No confident product: the category table decides.
  ["sour cream", "dairy_milk", null],
  ["2% milk", "dairy_milk", null],
  ["leftover pad thai", "cooked_leftovers", null],
  ["mystery item", "other", null],
];

test("items get USDA FoodKeeper shelf life, or fall back to their category", () => {
  for (const [name, category, days] of CASES) {
    const got = itemShelfLife(name, category);
    assert.equal(got?.days ?? null, days, `${name} (${category}) -> ${got?.product ?? "category"}`);
  }
});

test("matches never cross into the wrong food", () => {
  assert.match(itemShelfLife("pork chops", "raw_meat")!.product, /^Pork/);
  assert.match(itemShelfLife("large brown eggs", "eggs")!.product, /^Eggs/);
  assert.match(itemShelfLife("grapes", "fresh_fruit")!.product, /^Grapes/);
  assert.equal(itemShelfLife("black beans", "canned"), null); // not "Black bean sauce"
});
