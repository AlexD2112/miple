# fixtures/large — bulk synthetic test data for Miple

All of this data is **synthetic**: made by the seeded generators in `_gen/` (every record has `observed: false` or `synthetic: true`).
It sits apart from the curated fixtures in `fixtures/` and only reads them as inputs:
- `shelf_life.json` supplies shelf-life day counts and categories. No shelf-life number here was invented; every number comes from that file.
- `allergens.json` supplies the allergen terms and rules.
- `receipt_lines.json` supplies the store abbreviation and brand styles.

Master seed: **`SEED = 20261017`** (`_gen/common.py`). Each set uses a fixed offset from it, so the output is byte-for-byte reproducible.

| Set | Path | Count |
|---|---|---|
| Receipts (clean) | `receipts/clean/NNN/R#####_<store>.txt` (100 per shard dir) + `receipts/expected_clean.jsonl` | 2,400 receipts, 26,674 item records, all 7 stores |
| Receipts (OCR noise) | `receipts/ocr_noise/NNN/N#####_from_R#####.txt` + `receipts/expected_ocr_noise.jsonl` | 600 (ground truth = the clean receipt) |
| Receipt lines | `receipt_lines/lines_00{0,1,2}.jsonl` | 24,000 labeled lines |
| Pantry / expiry | `pantry/expiry_cases.jsonl` | 12,000 cases |
| Allergens | `allergens/cases.jsonl` | 9,900 cases (1,900 tricky, 6,000 composed, 2,000 name-only) |
| Planner | `planner/scenarios.jsonl` | 3,000 scenarios (17,420 expected free windows) |

Total size is about 41 MB. Each file is under 16 MB.

## Regenerate and validate
```
cd fixtures/large/_gen
python3 gen_receipts.py --n 2400 --noise 600
python3 gen_lines.py --n 24000
python3 gen_pantry.py --n 12000
python3 gen_allergens.py
python3 gen_planner.py --n 3000
cd .. && python3 validate.py        # prints OK {...counts...} or FAIL + errors
```
These scripts use only the Python standard library (3.10+).

## Receipts
- **Store layouts** follow the curated `fixtures/receipts/*.txt`: header, items, footer.
  - Flag letters: Safeway T/S, QFC and Fred Meyer T/F, TJ's T, Costco A/E, Whole Foods T/F, Target T/N.
  - Costco lines carry item numbers (random 4–7 digits, synthetic).
  - Line widths: Costco 44, others 40. Long descriptions are cut to the width, which counts as `truncation`.
- **Features**, counted per receipt in `features`:
  - Voids (`** VOID **`).
  - Multi-buy (`N @ N FOR X.XX`).
  - Weight pricing (`2.13 lb @ 1.99 /lb`).
  - Quantity details.
  - Price overrides (`PRICE OVERRIDE  WAS x`).
  - Loyalty, club and TPD lines.
  - Long coupon sections.
  - Returns and refunds (negative lines plus `REFUND - ORIG RECEIPT`).
  - Bag fees.
  - OR bottle deposits and CA CRV.
  - Non-food items.
  - Split tenders (gift card + card, cash + card) and cash change.
  - Line wraps.
- **Locations and tax.** Arithmetic is `tax = round_half_up(taxable_base × rate)` and `total = subtotal + tax`.
  - **WA (Seattle) 10.55%** (WA DOR rate, effective 2026-01-01).
    - Grocery food is exempt (RCW 82.08.0293).
    - Taxable: non-food, soft drinks, and hot prepared food.
    - The bag charge (8¢ paper) is taxable (WA DOR, reusable-bag fees).
  - **OR (Portland)**: no sales tax.
    - Bottle deposit 10¢.
    - Bag charge 5¢ (this amount is an assumption).
  - **CA (San Francisco) 8.625%** (CDTFA).
    - Carbonated drinks are taxable.
    - CRV is 5¢ (<24 oz) or 10¢. It is taxable when the drink is taxable.
    - The 25¢ bag charge is not taxable.
- **`expected_clean.jsonl`** has one record per receipt. Each record lists `items[]`, where each item has:
  - raw_text, normalized_name, quantity, unit, price, category, taxable.
  - line_type: sale, discount, fee, deposit or return.
  - Optional: unit_price, price_override_from, applies_to.

  Each record also has voided_lines, subtotal, taxable_base, tax, total, tenders, change, features and seed.
- **OCR noise** works on lines. It makes character swaps (O↔0, I↔1, S↔5, B↔8, …), drops spaces, and skews columns. It keeps the line count the same.
  - Each record copies the clean ground truth and adds `clean_ref` and `noise_ops`.
  - The validator checks that the ground truth matches the clean receipt it came from.

## Receipt lines
These are lines on their own: no receipt around them. Their style matches the curated `receipt_lines.json`.
- `line_type` counts:

  | line_type | count |
  |---|---|
  | sale | 16,331 (includes ~1,400 `ocr_noise: true` lines with `clean_text`) |
  | discount | 3,493 (`applies_to`) |
  | multibuy | 1,173 |
  | deposit | 714 |
  | return | 694 |
  | void | 484 |
  | fee | 464 |
  | weight_detail | 347 (`unit_price`; `quantity × unit_price = price`) |
  | qty_detail | 300 |

- Categories are the `shelf_life.json` categories plus `non_food`, `discount`, `deposit` and `fee`.

## Pantry / expiry
Each case computes `expected_expiry_date = purchase_date + <storage>_days`, using the item's category in `shelf_life.json`.
- If `requested_storage` is null, the category's `default_storage` is used.
- When the day count is null, `shelf_life_days` and the expiry are **null**. This applies to 2,174 cases (milk in the fridge, for example).
- Every curated example item runs against several edge dates in each storage mode (default, fridge, pantry, freezer):
  - 2024-02-29 and 2028-02-29.
  - 2027-02-28.
  - Month ends.
  - Dec 30/31, for year rollover.
- Tags: `month_rollover`, `year_rollover`, `spans_leap_day`, `purchased_on_leap_day`, `null_shelf_life`, `non_default_storage:<s>`.
- Days are calendar days. FoodKeeper units were already converted in `shelf_life.json` (week = 7, month = 30, year = 365).

## Allergens: labeling rules
The labels come from `_gen/allergen_matcher.py` (`analyze(name, ingredients)`). It uses only data in `../allergens.json`:

- **R1** Lowercase the text and match whole words. A simple plural (s/es) also matches. Commas, periods and parentheses act as list separators.
- **R2** Terms are the allergen's `terms`. Parentheticals are dropped and "/" alternatives are split.
- **R3** Free-from claims (`X-free`, `free of/from`, `made without`, `contains no`) become a `free_<key>` token.
  - A term directly after its own claim (e.g., "dairy-free cheese") does not count.
  - `lactose-free` is **not** a milk-free claim.
- **R4** Matches inside that allergen's `not_this_allergen` phrases are ignored. Examples: nutmeg, eggplant, buckwheat, cream of tartar, cocoa butter, water chestnut, butternut squash, highly refined peanut oil, coconut, rice/corn/oat.
- **R5** Allergen terms inside precautionary statements make the allergen **may_contain**. Allergen terms elsewhere make it **contains**.
  - Precautionary statements are: "may contain", "produced/processed/made/manufactured in a facility … processes", and "shared equipment".
  - Hits on the allergen's `may_contain` list (e.g., caesar dressing → fish, granola → tree nuts/peanuts) also make it may_contain.
  - Contains wins over may_contain.
- **R6** Plant or source qualifiers cancel generic dairy and grain words. The words are milk, cream, cheese, yogurt, ice cream, butter, flour, pasta, starch and lecithin.
  - Examples: oat milk, rice flour, corn starch, sunflower lecithin, almond butter.
  - The milk and wheat `notes` justify this rule.
- **R7** The legacy wording "tree nuts (coconut)" is read as coconut.
  - Coconut, chestnut, shea and the other `fda_excluded_since_2025` items are **not** tree nuts (FDA guidance, Jan 2025).
  - They are reported in `expected_fda_excluded_tree_nuts`.
  - `mollusks_optional` (clams, …) and `cross_reactive_not_major` (lupin) are reported separately. They never count as contains.
- **R8** A free-from claim also removes may_contain for the allergen it names.
- **R9** `expected_app_keys` maps to the app's keys: eggs→egg, tree nuts→tree_nut, peanuts→peanut, crustacean shellfish→shellfish.

Case kinds:
- **tricky**: 38 hand-written products, each with 50 variants. Their intended `contains` and `fda_excluded` labels are asserted when the set is built. They cover buckwheat, nutmeg, eggplant, coconut (current FDA rule), cream of tartar, peanut-free and nut-free claims, lactose-free milk, plant milks, water chestnut, chestnut, highly refined peanut oil, clams, lupin and may-contain statements.
- **composed**: built from neutral ingredients plus allergen terms. Some have a "Contains:" statement, a precautionary statement or a free-from name.
  - Generation asserts that `contains` equals exactly the allergens that were put in.
  - It also asserts that a precautionary allergen shows up as may_contain, and that a claimed allergen shows up in neither list.
- **name_only**: receipt-style names with no ingredient list. Treat these labels as lower bounds only.

`validate.py` re-runs the matcher on every case.

## Planner scenarios
Each scenario holds:
- `now`: local time, America/Los_Angeles.
- `days` and `has_calendar_access`.
- `profile`: allergies (app keys), calorie target and macro targets in grams.
- `pantry`: items with category, storage, purchase date, and `estimated_expiry` computed from shelf_life.json (null where it is null).
- `calendar_events`: these include all-day and `availability: free` events, which must be ignored.

`derived` holds only values that can be computed with no judgment. **No recipes are included.**
- `excluded_item_ids`: pantry items whose name-derived allergen keys overlap the allergies. The app's `gluten` is treated as wheat.
- `caution_item_ids`: items that are only may-contain.
- `expired_item_ids`, `expiring_within_days{0,1,3,7}`, `unknown_expiry_item_ids`.
- `ignored_event_ids`.
- `macro_kcal_from_targets` = 4P + 4C + 9F.
- `expected_free_windows`: the result of `mobile/src/lib/calendar.ts` `findFreeMealWindows(days, now)`. It is reproduced in `_gen/planner_logic.py` with these rules:
  - Lunch 11:30–14:00, dinner 17:30–21:00.
  - Start at max(window start, now rounded up to 15 min).
  - Take the first gap of at least 20 minutes, capped at 60.
  - With no calendar access, use a 40-minute fallback.
  - Events are those that overlap [now, now + days].

Edge cases: 2028-02-29, New Year's Eve, month ends, DST dates (wall-clock time), now at 20:40 vs 20:41, gaps of exactly 19, 20 or 21 minutes, and back-to-back events.

## Validation (`validate.py`)
- Every .json and .jsonl file parses, and each file is under 50 MB. The whole set must be under 300 MB.
- **Receipts:** each clean receipt is re-parsed from its text, independently of the generator. The checks cover:
  - Item sums, voids, subtotal, tax at the location's rate, total, and tenders minus change.
  - Item count, taxable flags, date, valid categories, `observed: false`, and that all 7 stores appear.
  - For noise copies: the ground truth matches the clean receipt and the line count is unchanged.
- **Receipt lines:** fields, categories, sign rules and weight arithmetic.
- **Pantry:** every expiry is recomputed from `shelf_life.json`.
- **Allergens:** the matcher is re-run on every case.
- **Planner:** expiries, allergen exclusions, expiry buckets and kcal are recomputed. Free windows are recomputed, plus independent checks: inside the meal window, not before now, 20–60 minutes long, no overlap with a busy block, and at most 40 minutes without calendar access.
