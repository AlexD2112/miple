// Builds server/data/foodkeeper.json from the USDA FSIS FoodKeeper export (CC0).
// Usage: node scripts/build-foodkeeper.mjs ../fixtures/_build/foodkeeper_foodsafetygov_en_20260416.json
//
// Each range keeps its shorter end ("3 - 5 Days" -> 3), so expiry estimates err on the safe side.
// Non-numeric values ("When Ripe", "Package use-by date", "Not Recommended") become null.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/build-foodkeeper.mjs <foodkeeper export .json>");
  process.exit(1);
}

const UNIT = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30, year: 365, years: 365 };

function toDays(value) {
  if (!value) return null;
  const m = String(value).match(/(\d+(?:\.\d+)?)\s*(?:-\s*\d+(?:\.\d+)?\s*)?(days?|weeks?|months?|years?)/i);
  return m ? Math.round(Number(m[1]) * UNIT[m[2].toLowerCase()]) : null;
}

// From-purchase values describe groceries as bought; fall back to the general value.
const pick = (p, purchase, general) => toDays(p[purchase]) ?? toDays(p[general]);

const raw = JSON.parse(readFileSync(source, "utf8"));
const products = raw.product_data
  .map((p) => ({
    id: Number(p.id),
    group: [p.category_name_display_only, p.subcategory_name_display_only].filter(Boolean).join(" / "),
    name: p.name.trim(),
    subtitle: (p.name_subtitle ?? "").trim(),
    keywords: [...new Set((p.keywords ?? "").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean))],
    fridge_days: pick(p, "from_date_of_purchase_refrigerate_output_display_only", "refrigerate_output_display_only"),
    pantry_days: pick(p, "from_date_of_purchase_pantry_output_display_only", "pantry_output_display_only"),
    freezer_days: pick(p, "from_date_of_purchase_freeze_output_display_only", "freeze_output_display_only"),
  }))
  .filter((p) => p.fridge_days ?? p.pantry_days ?? p.freezer_days);

const out = {
  source: "USDA FSIS FoodKeeper (foodsafety.gov), CC0 1.0. Shorter end of each range; weeks x7, months x30, years x365.",
  built_from: source.split(/[\\/]/).pop(),
  products,
};
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "foodkeeper.json");
writeFileSync(target, JSON.stringify(out) + "\n");
console.log(`wrote ${products.length} products to ${target}`);
