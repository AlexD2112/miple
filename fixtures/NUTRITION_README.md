# Miple nutrition reference data (H6)

All paths below are relative to the repo root.

`nutrition.csv` has per-100 g macros for **455 common US grocery items**: produce, dairy, eggs, meat, seafood, bakery, grains, canned goods, frozen foods, snacks, condiments and beverages. Each item has receipt-style aliases, a typical retail package size, and a category that uses **exactly the shelf-life keys in the Miple repo**.

## Files
| path | what |
|---|---|
| `fixtures/nutrition.csv` | the dataset (455 rows) |
| `fixtures/nutrition.json` | the same rows as JSON (aliases as an array, blanks as `null`), loaded by `server/src/domain/nutrition.ts` |
| `fixtures/shelf_life.json` | **DRAFT** proposal (see "Categories") |
| `scripts/nutrition/items.txt` | the hand-curated list: item, aliases, exact FDC description, category, package size and description |
| `scripts/nutrition/download.sh` | downloads and unpacks the two FDC CSV zips into `ff/` and `sr/` |
| `scripts/nutrition/flatten_fdc.py` | turns the two FDC CSV dumps into `fdc_flat.csv` (one row per food, energy/protein/carb/fat/fiber) |
| `scripts/nutrition/build_nutrition.py` | matches `items.txt` to FDC, applies the fallbacks below, sanity-checks every row, writes `nutrition.csv` + `nutrition.json` |
| `server/src/domain/nutrition.ts` | receipt-line matcher (see "Receipt matcher") |

Rebuild (needs pandas; the raw FDC data is not committed):
```sh
mkdir -p /tmp/fdc && cd /tmp/fdc
bash <repo>/scripts/nutrition/download.sh
python3 <repo>/scripts/nutrition/flatten_fdc.py && python3 <repo>/scripts/nutrition/build_nutrition.py
cp nutrition.csv nutrition.json <repo>/fixtures/
```
The build stops with an error if any description fails to match or any category is not a valid repo key.

## Receipt matcher
`matchReceiptLine(line)` in `server/src/domain/nutrition.ts` maps a raw receipt line to one fixture row and returns `{ row, matched, method, confidence, normalized }`, or `null`.
1. **Non-food lines return `null`**: tax, bag fee, CRV/deposit, coupon, subtotal, payment lines.
2. **Normalize**: lowercase the line and strip prices, weights and counts (`1.52LB`, `12CT`, `3PK`), unit prices (`@ 0.59/LB`), PLU/UPC codes, store brands (GV, KS, TJ's...), and packaging/marketing words. Common abbreviations are expanded (`BNLS CHKN BRST` → `boneless chicken breast`), and plurals are made singular. Numeric tokens that appear in an alias, such as `80/20`, `93/7` or `2%`, are kept.
3. **Exact lookup**: if the normalized line equals an item name or alias, `confidence` is 1.
4. **Fuzzy fallback**: each alias gets a token-overlap score. Tokens match exactly, as an abbreviation (prefix, or the letters in order), or by edit distance, but a word that is already in the fixture vocabulary only matches exactly. The score weights how much of the alias is covered (0.65) above how much of the line is covered (0.35), and confidence is capped at 0.99. Lines scoring below 0.5 return `null`. In the `POST /receipts/parse` response, `nutrition.needs_review` is `true` when confidence is below `NUTRITION_REVIEW_THRESHOLD` (0.7, exported from `nutrition.ts`). Ask the user to confirm those matches.
Tests are in `server/src/domain/nutrition.test.ts` and run with `npm test`.

## Sources
USDA FoodData Central bulk downloads, from https://fdc.nal.usda.gov/download-datasets. These are public domain (CC0) and need no API key.
- **Foundation Foods, April 2026 release** (CSV `FoodData_Central_foundation_food_csv_2026-04-30.zip`). 395 foods. **219 rows** in this file.
- **SR Legacy, April 2018 release** (CSV `FoodData_Central_sr_legacy_food_csv_2018-04.zip`). This is the final release and will not be updated. 7,793 foods. **236 rows** in this file.

## Method
1. I hand-picked the item list for typical supermarket receipt lines. For each item I chose the plain, raw or as-purchased form ("Spinach, mature", "Chicken, breast, boneless, skinless, raw", "Pasta, dry, enriched").
2. I used **Foundation Foods when it had a good match with energy data**. Otherwise I used SR Legacy. Some Foundation records have no energy values at all, so SR Legacy is used for those items: oils, butter, mayo, sliced bread, dry pasta, tortillas, deli meats, raisins, blackberries, watermelon, refried beans, and a few others. Some Foundation forms are not as purchased, such as dry beans at "0% moisture". For those I used the SR Legacy raw form.
3. Nutrients per 100 g: Energy kcal = nutrient **1008**. For Foundation foods without 1008, I used Atwater Specific Factors **2048**, then Atwater General Factors **2047**. Column `energy_source_nutrient` records which one: 1008 for 286 rows, 2048 for 148, 2047 for 21. Protein = 1003, Carbohydrate by difference = 1005, Total lipid = 1004, Fiber = 1079. Values are rounded to 0.1.
4. **Fiber gaps.** Fiber (1079) is missing from many newer Foundation records. Column `fiber_source` shows how each value was filled:
   - `fdc`: from the matched record (331 rows).
   - `sr_legacy:<fdc_id>`: borrowed from a hand-picked equivalent SR Legacy food (48 rows). Examples: grapes, berries, lettuces, potatoes, canned beans, oats, flour, juices.
   - `assumed_zero`: set to 0 for foods with no plant material (75 rows): meat, poultry, seafood, dairy, eggs, sugar, salt, coconut oil.
   - blank: fiber still unknown (1 row, tempeh). See Caveats.
5. **Negative carbs.** In Foundation meat records, carbohydrate by difference is sometimes slightly negative (−0.1 to −0.7 g) because of measurement noise. These values are set to 0. This affects 10 rows: chicken wings, drumsticks, bone-in breast and thighs, pork chops, pork belly, ground lamb, ground bison, halibut and tuna. Salt has no protein, carb or fat values, so those are set to 0.
6. **Sanity checks.** The build checks each row for duplicate names or aliases, invalid categories, kcal over 902, macros adding up to more than 100 g, "cooked" in a description outside `cooked_leftovers`, and kcal more than 25% away from 4/4/9 × macros. I reviewed all 455 rows by hand. The remaining 4/4/9 mismatches are expected: spices, cocoa, mushrooms, leafy greens, lemons and limes (because of fiber and specific Atwater factors), and vanilla extract (alcohol).

## Columns
| column | meaning |
|---|---|
| `item_name` | short, receipt-friendly name; unique |
| `aliases` | pipe-separated receipt variants and abbreviations (unique across the file) |
| `fdc_id` | FoodData Central ID |
| `fdc_description` | FDC description of that record |
| `data_type` | `foundation` or `sr_legacy` |
| `category` | one of the 25 keys of `public.shelf_life` / `CATEGORIES` in the repo |
| `calories_kcal_100g` | energy, kcal per 100 g |
| `protein_g_100g`, `carbs_g_100g`, `fat_g_100g`, `fiber_g_100g` | grams per 100 g (carbs = by difference, includes fiber) |
| `typical_package_size_g` | **ESTIMATE** of a common US retail package, in grams |
| `typical_package_desc` | e.g. `1 gallon`, `12 eggs (dozen, large, edible portion)`, `5 oz clamshell` |
| `energy_source_nutrient` | 1008, 2048 or 2047 (see Method) |
| `fiber_source` | `fdc`, `sr_legacy:<id>` or `assumed_zero` (see Method) |

## Categories
The repo has **no `fixtures/shelf_life.json`**. The category list lives in `supabase/migrations/0001_init.sql` (the `shelf_life` table, 25 rows) and is mirrored in `server/src/domain/schemas.ts` (`CATEGORIES`). I checked against commit 914c23e. Every row in this file uses one of those keys:
`leafy_greens, berries, fresh_fruit, fresh_vegetables, root_vegetables, herbs, raw_poultry, raw_meat, raw_seafood, deli_meat, dairy_milk, dairy_cheese, yogurt, eggs, tofu, bread, tortillas, cooked_leftovers, frozen, canned, dry_goods, condiments, snacks, beverages, other`.

Some foods have no category of their own, so I put them in the closest key:
- spices, oils, nuts, seeds, dried fruit, flour, sugar → `dry_goods`
- butter → `dairy_cheese` (21 days; butter really keeps 1–3 months)
- sour cream → `yogurt`
- plant milks → `dairy_milk`
- nut butters, honey, syrups → `condiments`
- hummus → `other`
- rotisserie chicken → `cooked_leftovers`
- tempeh → `tofu`
- coleslaw mix → `fresh_vegetables`
- radishes, winter squash → `root_vegetables`
- Seafood that Foundation sampled frozen (halibut, ahi tuna, mahi mahi, scallops, lobster) stays in `raw_seafood`, which is the conservative 2-day choice.

`fixtures/shelf_life.json` is a **draft proposal** and is not in the repo yet. Its `days` values are copied exactly from the migration, and the build checks that they match. It also proposes `fridge_days`, `pantry_days` and `freezer_days` per category for a possible storage-aware expiry later. Those proposed numbers are unverified estimates.

## Caveats
- **Package sizes are my estimates**, not data. Liquids are converted at about 1 g/ml, except oils (0.92), maple syrup and pancake syrup (about 1.3), milk (about 1.03) and ice cream (about 0.6 by volume). Produce sold by count uses a typical unit weight, for example eggs at 50 g edible each and an avocado at 200 g.
- **Tempeh fiber is intentionally blank** (SR 174272; `fiber_g_100g` is empty in the CSV and `null` in the JSON, and `fiber_source` is empty). No tempeh record in SR Legacy or Foundation has a fiber value, and I didn't substitute another food. Treat this as unknown, not 0. Three SR records that also lacked fiber borrow it from the nearest SR record: canned coconut milk ← raw coconut milk (170172, 2.2 g), trail mix ← trail mix with chocolate chips (167969, 5.0 g), balsamic vinegar ← red wine vinegar (172240, 0.0 g).
- **These rows are proxies, not exact matches:**
  - spring mix → butterhead lettuce
  - frozen mixed berries → frozen raspberries
  - Dijon mustard → yellow mustard
  - cooking spray → corn and canola oil per 100 g
  - colby jack → colby
  - sourdough → French/Vienna bread
  - corn flakes → Ralston Corn Flakes
  - sports drink → Gatorade G
  - energy drink → Red Bull
  - deli chicken → rotisserie-seasoned deli breast
  - smoked sausage → Polish beef with chicken
  - cold brew / bottled coffee → brewed coffee
- **These values are not for the raw product**, because FDC only has prepared values for them:
  - frozen pizza is "frozen, cooked"
  - fish sticks are "frozen, prepared"
  - chicken nuggets are "precooked, frozen, not reheated", which is how they are sold
  - canned soups are condensed (undiluted)
  - lemonade is "prepared with water"
- Alfredo is only available as a dry mix, so the row is `alfredo sauce mix`.
- Diet cola is a 2-kcal SR record. Bottled and sparkling water are 0.
- Canned beans are drained and rinsed. Canned fruit includes the syrup or juice.
- Values are per 100 g of edible portion. Bone, shell and peel are not included in the macros. `typical_package_size_g` for bone-in cuts is the gross package weight.
