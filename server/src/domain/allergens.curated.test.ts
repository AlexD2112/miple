import assert from "node:assert/strict";
import { test } from "node:test";
import { findAllergens } from "./allergens.js";

// Keywords from miple-testdata bundle_small/data/small/allergen_keywords.csv that the matcher used to miss.
const MUST_MATCH: [string, string][] = [
  ["buttermilk pancakes", "milk"], ["half-and-half", "milk"], ["brie", "milk"], ["mascarpone", "milk"],
  ["lemon curd", "milk"], ["dark chocolate", "milk"], ["egg yolk", "egg"], ["vanilla custard", "egg"],
  ["hollandaise", "egg"], ["spinach omelette", "egg"], ["pollock fillets", "fish"], ["catfish", "fish"],
  ["surimi", "fish"], ["dashi stock", "fish"], ["imitation crab", "fish"], ["krill oil", "shellfish"],
  ["seafood medley", "shellfish"], ["frangipane tart", "tree_nut"], ["mixed nuts", "tree_nut"],
  ["mixed nuts", "peanut"], ["nut butter", "peanut"], ["udon noodles", "wheat"], ["ramen", "gluten"],
  ["saltine crackers", "wheat"], ["croutons", "gluten"], ["everything bagel", "sesame"], ["natto", "soy"],
  ["tvp crumbles", "soy"], ["soy lecithin", "soy"], ["halva", "sesame"], ["zaatar", "sesame"], ["beer batter", "gluten"],
];

// Close calls that must stay allergen-free.
const MUST_NOT_MATCH: [string, string][] = [
  ["rice crackers", "wheat"], ["rice crackers", "gluten"], ["corn starch", "wheat"], ["dried spaghetti", "egg"],
  ["peanut-free granola", "tree_nut"], ["coconut", "tree_nut"], ["nutmeg", "tree_nut"], ["butternut squash", "tree_nut"],
  ["solely vegetables", "fish"],
];

test("curated bundle keywords are matched", () => {
  for (const [text, allergy] of MUST_MATCH) assert.deepEqual(findAllergens([text], [allergy]), [allergy], `${text} / ${allergy}`);
});

test("close calls stay clear", () => {
  for (const [text, allergy] of MUST_NOT_MATCH) assert.deepEqual(findAllergens([text], [allergy]), [], `${text} / ${allergy}`);
});
