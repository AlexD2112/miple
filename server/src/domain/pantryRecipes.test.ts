import assert from "node:assert/strict";
import { test } from "node:test";
import { groundRecipesToPantry, isAllowedStaple, samePantryFood } from "./pantryRecipes.js";

const pantry = [
  { id: "spinach", name: "organic spinach" },
  { id: "eggs", name: "eggs" },
  { id: "pepper", name: "bell pepper" },
];

test("matches a pantry item with extra words or a plural", () => {
  assert.equal(samePantryFood("spinach", "organic spinach"), true);
  assert.equal(samePantryFood("egg", "eggs"), true);
  assert.equal(samePantryFood("eggplant", "egg"), false);
  assert.equal(samePantryFood("black pepper", "bell pepper"), false);
});

test("drops a recipe that adds a food the pantry does not have", () => {
  const [kept] = groundRecipesToPantry(
    [
      {
        title: "Spinach and eggs",
        ingredients: [
          { pantry_item_id: "spinach", name: "spinach", quantity: "2 cups" },
          { pantry_item_id: "eggs", name: "eggs", quantity: "2" },
        ],
      },
      {
        title: "Spinach pasta",
        ingredients: [
          { pantry_item_id: "spinach", name: "spinach", quantity: "2 cups" },
          { pantry_item_id: null, name: "pasta", quantity: "200 g" },
        ],
      },
      {
        title: "Pepper oil",
        ingredients: [{ pantry_item_id: "pepper", name: "olive oil", quantity: "1 tbsp" }],
      },
    ],
    pantry,
  );

  assert.equal(kept?.title, "Spinach and eggs");
  assert.deepEqual(
    kept?.ingredients.map((ingredient) => ingredient.name),
    ["organic spinach", "eggs"],
  );
});

test("staples are salt, pepper, butter, and oil", () => {
  assert.equal(isAllowedStaple("olive oil"), true);
  assert.equal(isAllowedStaple("black pepper"), true);
  assert.equal(isAllowedStaple("butter"), true);
  assert.equal(isAllowedStaple("kosher salt"), true);
  assert.equal(isAllowedStaple("bell pepper"), false);
  assert.equal(isAllowedStaple("pasta"), false);
});

test("allows staples only when the setting is on", () => {
  const draft = {
    title: "Spinach",
    ingredients: [
      { pantry_item_id: "spinach", name: "spinach", quantity: "2 cups" },
      { pantry_item_id: null, name: "olive oil", quantity: "1 tbsp" },
      { pantry_item_id: null, name: "salt", quantity: "a pinch" },
    ],
  };
  assert.equal(groundRecipesToPantry([draft], pantry).length, 0);
  const [kept] = groundRecipesToPantry([draft], pantry, { staples: true });
  assert.deepEqual(
    kept?.ingredients.map((ingredient) => ingredient.name),
    ["organic spinach", "olive oil", "salt"],
  );
  assert.equal(kept?.ingredients[1].pantry_item_id, null);
});
