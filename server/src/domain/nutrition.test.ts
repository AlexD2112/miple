import assert from "node:assert/strict";
import { test } from "node:test";
import { loadNutrition, matchReceiptLine, normalizeReceiptLine } from "./nutrition.js";
import { CATEGORIES } from "./schemas.js";

// Realistic receipt lines (Safeway / Walmart / Costco / Trader Joe's / QFC style) -> expected nutrition.csv item.
const SAMPLES: [line: string, expected: string][] = [
  ["BNLS CHKN BRST 1.52LB 7.58", "chicken breast"],
  ["ORG SPNCH 5OZ 3.99", "spinach"],
  ["KS ORG BABY SPINACH 1LB 4.49", "baby spinach"],
  ["BANANAS 2.34 LB @ 0.59/LB 1.38", "banana"],
  ["GV WHOLE MILK GAL 3.48 F", "whole milk"],
  ["LG EGGS 12CT 4.29", "eggs"],
  ["GRND BEEF 80/20 1.01LB 5.04", "ground beef 80/20"],
  ["GRD TURKEY 93/7 1LB 4.99", "ground turkey"],
  ["AVOCADO HASS EA 1.25", "avocado"],
  ["STRAWBERRIES 1LB 3.99", "strawberries"],
  ["BLUEBERRIES PINT 4.99", "blueberries"],
  ["SHRD MOZZ 8OZ 2.79", "mozzarella"],
  ["CHOBANI GRK YOG PLN 32OZ 5.99", "greek yogurt"],
  ["YELLOW ONIONS 3LB BAG 2.99", "yellow onion"],
  ["RUSSET POTATOES 5LB 3.49", "russet potatoes"],
  ["ROMAINE HEARTS 3PK 3.49", "romaine"],
  ["BLK BEANS 15OZ 0.89", "black beans"],
  ["SPAGHETTI 16OZ 1.29", "spaghetti"],
  ["JASMINE RICE 5LB 7.99", "white rice"],
  ["EVOO 1L 8.99", "olive oil"],
  ["KIKKOMAN SOY SAUCE 10OZ 3.29", "soy sauce"],
  ["PEANUT BUTTER CRMY 16OZ 2.98", "peanut butter"],
  ["SALMON FILLET ATL 1.2LB 11.99", "salmon"],
  ["RAW SHRIMP 31/40 2LB 15.99", "shrimp"],
  ["BABY CARROTS 1LB 1.29", "baby carrots"],
  ["BROCCOLI CROWNS 1.30 LB @ 1.99/LB 2.59", "broccoli"],
  ["FRZN PEAS 12OZ 1.19", "frozen peas"],
  ["TORTILLA CHIPS 13OZ 3.49", "tortilla chips"],
  ["OJ NO PULP 52OZ 4.29", "orange juice"],
  ["CHEDDAR SHARP 8OZ 2.50", "cheddar cheese"],
  ["GARLIC 3PK 1.99", "garlic"],
  ["COLA 12PK 12OZ CANS 6.99", "cola"],
  ["HONEYCRISP APPLES 3LB 5.99", "honeycrisp apple"],
  ["BTR UNSLTD 4 STICKS 4.49", "unsalted butter"],
  ["2% MILK HALF GAL 2.19", "2% milk"],
  ["TJ'S PLAIN GREEK YOGURT 32OZ", "greek yogurt"],
  ["4011 BANANAS ORG", "banana"],
  ["CILANTRO BUNCH 0.99", "cilantro"],
  ["WHL WHT BREAD 20OZ 3.29", "whole wheat bread"],
];

const NON_FOOD = ["BAG FEE 0.10", "SALES TAX 1.23", "CRV 0.60", "SUBTOTAL 54.12", "VISA DEBIT 54.12", "COUPON -1.00"];

test("normalizes prices, weights, unit prices, brands and abbreviations", () => {
  assert.equal(normalizeReceiptLine("BNLS CHKN BRST 1.52LB 7.58"), "boneless chicken breast");
  assert.equal(normalizeReceiptLine("BANANAS 2.34 LB @ 0.59/LB 1.38"), "banana");
  assert.equal(normalizeReceiptLine("GRND BEEF 80/20 1.01LB"), "ground beef 80/20");
  assert.equal(normalizeReceiptLine("4011 BANANAS ORG"), "banana");
});

test("maps realistic receipt lines to the right nutrition row", () => {
  const misses: string[] = [];
  for (const [line, expected] of SAMPLES) {
    const m = matchReceiptLine(line);
    if (m?.row.item_name !== expected) misses.push(`${line} -> ${m?.row.item_name ?? "null"} (want ${expected})`);
  }
  const acc = (SAMPLES.length - misses.length) / SAMPLES.length;
  console.log(`receipt matcher accuracy: ${SAMPLES.length - misses.length}/${SAMPLES.length} (${(acc * 100).toFixed(0)}%)`);
  assert.deepEqual(misses, []);
});

test("exact alias hits get confidence 1, fuzzy hits less", () => {
  assert.deepEqual(
    { ...matchReceiptLine("LG EGGS 12CT 4.29"), row: undefined },
    { row: undefined, matched: "large egg", method: "exact", confidence: 1, normalized: "large egg" },
  );
  const fuzzy = matchReceiptLine("CHOBANI GRK YOG PLN 32OZ 5.99");
  assert.equal(fuzzy?.method, "fuzzy");
  assert.ok(fuzzy!.confidence > 0.5 && fuzzy!.confidence < 1);
});

test("non-food and unknown lines return null", () => {
  for (const line of NON_FOOD) assert.equal(matchReceiptLine(line), null, line);
  assert.equal(matchReceiptLine("PAPER TOWELS 6PK 8.99"), null);
  assert.equal(matchReceiptLine("1234567890123"), null);
});

test("fixture rows are well-formed and use repo shelf-life categories", () => {
  const rows = loadNutrition();
  assert.ok(rows.length >= 300);
  for (const r of rows) {
    assert.ok((CATEGORIES as readonly string[]).includes(r.category), `${r.item_name}: ${r.category}`);
    assert.ok(r.calories_kcal_100g !== null && r.calories_kcal_100g >= 0 && r.calories_kcal_100g <= 902);
    assert.ok(r.typical_package_size_g > 0);
  }
});
