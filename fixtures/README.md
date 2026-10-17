# Miple test fixtures

Fixture data for **Miple** (DubHacks 2026): receipt scanning → pantry items → expiry estimates (purchase date + category shelf life) → recipe planning with a hard allergy filter.

Validate everything with:

```bash
python3 fixtures/validate.py
```

That script checks every JSON file parses, every category used is either in `shelf_life.json` or one of `non_food` / `discount` / `deposit` / `fee`, that `receipt_lines.json` has ≥150 lines covering all 7 stores, that each allergen has ≥20 terms, and it **re-parses every `receipts/*.txt` independently**. It sums the printed lines, handles VOID lines, recomputes tax from the tax-flag letters and checks subtotal/tax/total/date/items against `receipts/expected.json`. Current output:

```
OK: 27 shelf-life categories, 153 examples, 176 receipt lines (3 observed), 9 allergens, 10 receipts verified
```

## Files

| File | Contents |
|---|---|
| `shelf_life.json` | `source` (provenance), `categories` (27 entries, each with `app_category_key` mapping to `server/src/domain/schemas.ts` CATEGORIES), `examples` (153 item→category mappings) |
| `receipt_lines.json` | `_meta` (category conventions, observed sources) + `lines` (176 line items, 3 observed / 173 synthetic) |
| `receipts/01…10_*.txt` | 10 complete synthetic receipts (Safeway ×2, QFC, Fred Meyer, Trader Joe's ×2, Costco ×2, Whole Foods, Target) |
| `receipts/expected.json` | Correct parse for each receipt, keyed by filename: items, voided_lines, subtotal, tax, total, date, taxable_base |
| `allergens.json` | 9 US major allergens with hard-match `terms`, `may_contain`, `not_this_allergen` (false-positive traps), `notes`, `sources` |
| `validate.py` | Validation and consistency checks (above) |
| `_build/` | Generator scripts plus the FoodKeeper JSON snapshot used, so every number can be audited and regenerated (`cd fixtures/_build && python3 build_shelf_life.py && python3 add_examples.py && python3 build_receipt_lines.py && python3 build_receipts.py && python3 build_allergens.py`) |

## 1. shelf_life.json

**Source:** USDA FSIS FoodKeeper data, English JSON, published on foodsafety.gov
(`https://www.foodsafety.gov/sites/default/files/foodkeeper_data_url_en.json`; catalog: https://catalog.data.gov/dataset/fsis-foodkeeper-data, CC0).
The official fsis.usda.gov and foodsafety.gov downloads returned HTTP 403 from our network, so the file was retrieved from the Internet Archive capture of that exact URL from **2026-04-16**:
https://web.archive.org/web/20260416174248id_/https://www.foodsafety.gov/sites/default/files/foodkeeper_data_url_en.json
(661 products; snapshot saved as `_build/foodkeeper_foodsafetygov_en_20260416.json`).

**Method (from `_build/build_shelf_life.py`):**
* Each category cites specific FoodKeeper product IDs and fields (e.g. `#415 "Bagged greens" refrigerate="3 - 5 Days"`). The full citation for every number is in `source_note`, and the IDs are in `foodkeeper_product_ids`.
* A range uses its **shorter end**. Category value = **minimum** across the cited products (conservative). The one exception is fresh herbs, which uses FoodKeeper's generic "Herbs" product (#288).
* Unit conversion: 1 week = 7 days, 1 month = 30 days, 1 year = 365 days.
* Non-numeric FoodKeeper values (`When Ripe`, `Package use-by date`, `Not Recommended`, `Indefinitely`) are never converted. They produce `null`.
* Numbers are computed from the snapshot by the script, never typed in by hand. The script asserts that each cited field exists.
* For some categories (canned goods, opened condiments, dry goods, beverages, bread) `fridge_days` is FoodKeeper's *refrigerate after opening* value. This is flagged in `source_note`.
* 2 categories were added to the 25 requested: `beverages` and `snacks`, because real receipts are full of them.

| category | fridge | pantry | freezer | default | FoodKeeper IDs |
|---|---|---|---|---|---|
| leafy greens | 3 | None | None | fridge | #291, #415 |
| berries | 2 | None | 240 | fridge | #253, #254, #481, #482 |
| other fresh fruit | 3 | 1 | 30 | fridge | #248, #250, #251, #256, #261, #266 |
| root vegetables | 7 | 14 | 180 | fridge | #274, #279, #294, #297, #299, #307, #422 |
| other fresh vegetables | 3 | None | 150 | fridge | #271, #276, #280, #281, #283, #292, #296, #302, #600 |
| fresh herbs | 7 | None | 30 | fridge | #288 |
| raw poultry | 1 | None | 270 | fridge | #113, #114, #116, #117, #118 |
| raw ground meat | 1 | None | 90 | fridge | #43, #50, #73, #115 |
| raw whole cuts | 3 | None | 120 | fridge | #36, #40, #51, #64, #67 |
| raw fish | 1 | None | 60 | fridge | #144, #145, #146 |
| deli meat | 3 | None | 30 | fridge | #184, #192 |
| eggs | 21 | None | None | fridge | #21 |
| milk | None | None | 90 | fridge | #27 |
| yogurt | 7 | None | 30 | fridge | #33 |
| soft cheese | 7 | None | 180 | fridge | #7, #9, #10, #490 |
| hard cheese | 180 | None | 180 | fridge | #3 |
| butter | 30 | 1 | 180 | fridge | #1 |
| bread | 14 | 14 | 90 | pantry | #195 |
| tortillas | 60 | 25 | 180 | pantry | #196, #553 |
| cooked leftovers | 3 | None | 30 | fridge | #141, #173, #174, #185 |
| tofu | 7 | None | 150 | fridge | #168 |
| opened condiments | 30 | None | None | fridge | #348, #350, #351, #356, #357, #360 |
| canned goods | 3 | 360 | None | pantry | #372, #373 |
| dry goods/grains | 180 | 90 | 240 | pantry | #222, #223, #333, #334, #335, #338, #339, #577, #581, #585 |
| frozen foods | 3 | None | 90 | freezer | #313, #315, #317, #321, #330, #331 |
| beverages | 2 | 21 | None | pantry | #404, #407 |
| snacks | None | 60 | None | pantry | #374, #377, #392, #394, #658 |

**Null fields (26), and why:**
* **Not applicable / no FoodKeeper pantry entry** (perishable refrigerated food): pantry for leafy greens, berries, fresh herbs, raw poultry, raw ground meat, raw whole cuts, raw fish, deli meat, eggs, milk, yogurt, soft cheese, hard cheese, cooked leftovers, tofu, frozen foods.
* **other fresh vegetables.pantry**: no single number. Tomatoes are "When Ripe" (#306), cherry tomatoes P=10 Days (#600), and most others have no pantry entry.
* **FoodKeeper says "Not Recommended"**: leafy greens.freezer (#415, #291), eggs.freezer (in shell, #21).
* **milk.fridge_days**: FoodKeeper gives "Package use-by date" (#27), not a number. **The app must use the printed date or ask the user.** This is the biggest practical gap.
* **opened condiments.pantry / .freezer**: the category models opened items (fridge after opening). FoodKeeper has no freezer values for these products.
* **canned goods.freezer**: no FoodKeeper entry.
* **beverages.freezer, snacks.fridge, snacks.freezer**: not typical, so no value was used.

## 2. receipt_lines.json

176 lines: Safeway 25, QFC 24, Fred Meyer 25, Trader Joe's 26, Costco 26, Whole Foods 26, Target 24.
Hard cases covered: heavy abbreviations (`ORG SPNCH 5OZ`, `1170000 KS ROTIS CHKN`, `FSTR FRMS BNLS BRST`), weight detail lines (`1.32 lb @ 0.99 /lb`), qty detail lines (`3 @ 0.89`), multi-buy (`2 @ 2 FOR 5.00 BARILLA PENNE`), Costco item numbers and `TPD/` instant-savings lines, store-brand prefixes (KS, O Organics, Signature Select/Kitchens, Lucerne, Kroger/KRO, Simple Truth, Private Selection, 365, Good & Gather, TJ'S), coupons, loyalty, digital and manufacturer discounts as negative lines, deposits/CRV, bag fees, non-food items, and a zero-value promo line.

* **observed: 3 lines / synthetic: 173 lines.** All 3 observed lines are Costco lines typed by Reddit posters quoting their own receipts. Text only, no images were saved or uploaded, and no personal data was copied:
  * `** KS TOWELS **` ($18.79 per poster): https://www.reddit.com/r/Costco/comments/x6vqkt/what_does_the_two_asterisks_mean_on_my_receipt/
  * `KS Chic tort`, `KS dbl roll` (price not given, so `null`; the meaning is uncertain even in the thread): https://www.reddit.com/r/Costco/comments/qf2v0q/confusion_from_receipt/
* Receipt-generator / "template" websites were reviewed but **not** counted as observed, because their text is not from real receipts.
* All Costco item numbers on synthetic lines are fake placeholders.
* `price` is the extended line amount. Detail lines (`… lb @ … /lb`, `N @ …`) are included as separate rows with the same item fields. Their `normalized_name` ends in `(weight detail line)` / `(qty detail line)`, so a parser can learn to merge them and must not double count.

**Extra categories** (beyond shelf_life):
* `non_food`: household and personal care. Not added to the pantry.
* `discount`: coupons, loyalty, instant savings. Negative `price`, or 0 for non-monetary promos.
* `deposit`: bottle deposit / CRV. **Washington has no bottle deposit**, so these lines model Oregon (Fred Meyer) and California (Safeway, TJ's) receipts.
* `fee`: carryout bag charge.

## 3. receipts/*.txt + expected.json

10 synthetic receipts dated 2026-09-12 … 2026-10-14, laid out like each chain's thermal-paper format. They are approximations; none is a real store layout. Store numbers, addresses and phone numbers are fictional, and card and member numbers are masked.
* Easy: 01 Safeway, 04 Trader Joe's, 10 Trader Joe's (2 items).
* Messy: **02 QFC has a long coupon section** (6 coupons, one of them on a taxable item). **03 Fred Meyer has a voided item** (`** VOID **`). 08 Safeway has OCR-style damage (O→0, doubled spaces, `120Z`, `3O18`). 05 and 09 Costco have item numbers, `TPD/` instant savings and truncated descriptions. 06 Whole Foods has a Prime deal and a taxable hot bar. 07 Target mixes taxable and nontaxable lines.
* In `expected.json`, `raw_text` is exactly what is printed, including truncation and OCR damage. Detail lines are merged into their item, voided items are excluded (listed in `voided_lines`), and items appear in printed order.
* Arithmetic: subtotal = sum of all non-voided lines (including negative discounts and fees). Tax = round_half_up(taxable_base × rate). Total = subtotal + tax. Verified by `validate.py`.

**Tax assumptions (Washington):**
* **Rate 10.55%, not 10.35%.** WA DOR raised Seattle's combined rate to 10.55% effective 2026-01-01 (state 6.5% + local 4.05%): https://dor.wa.gov/sites/default/files/2025-11/Seattle-LLEP-Q1-26.pdf. 10.35% was the 2025 rate. All receipts are dated 2026 and located in Seattle.
* Grocery food is exempt (RCW 82.08.0293: https://app.leg.wa.gov/rcw/default.aspx?cite=82.08.0293).
* Taxable: non-food items, **soft drinks** (sweetened, ≤50% juice: Coke/Pepsi; unsweetened LaCroix and bottled water are treated as exempt; https://dor.wa.gov/education/industry-guides/restaurants-and-retailers-prepared-food/sales-sealed-beverages), and **prepared food** (hot bar, hot rotisserie chicken; WAC 458-20-244: https://app.leg.wa.gov/WAC/default.aspx?cite=458-20-244). Classifying rotisserie chicken as "prepared food" assumes it is sold heated.
* **Carryout bag charges are taxable** per WA DOR (https://dor.wa.gov/forms-publications/publications-subject/tax-topics/reusable-bag-fees). Rates are 8¢ paper and 12¢ reusable film plastic from 2026-01-01 (https://ecology.wa.gov/about-us/who-we-are/news/2025/nov-18-bring-your-own-bag-avoid-a-fee-increase-on-store-bought-bags).
* A discount tied to a taxable item reduces the taxable base. This is a simplification: real treatment of manufacturer coupons can differ.
* Tax-flag letters (T/F, T/S, T/N, A/E) vary by chain and are shopper folklore, not documented. Each receipt prints a legend line, which the validator uses.

## 4. allergens.json

All 9 US major allergens (FALCPA + FASTER Act sesame, 2023), with term counts: milk 52, eggs 34, fish 37, crustacean shellfish 27, tree nuts 54, peanuts 26, wheat 52, soy 38, sesame 24.
Terms come from FARE's per-allergen "avoid foods that contain" lists. Our additions (synonyms and common product names) are listed separately in `added_terms` for honesty.
`may_contain` = warn / confirm. `not_this_allergen` = false-positive traps to check before substring matching (buckwheat, eggplant, nutmeg, butternut squash, water chestnut, cocoa butter, coconut/oat milk, refined peanut/soy oil…). Crustacean shellfish also has `mollusks_optional`, since mollusks are not a US major allergen.

**Coconut / tree nuts (verified 2026-10-17):** FDA's final guidance *Questions and Answers Regarding Food Allergens… (Edition 5)* (Jan 6, 2025; Federal Register Jan 7, 2025) cut the tree-nut list from 23 to 12 (almond, black walnut, Brazil nut, California walnut, cashew, filbert/hazelnut, heartnut, macadamia, pecan, pine nut, pistachio, English/Persian walnut). It removed coconut, kola, beech, butternut, chestnut, chinquapin, ginkgo, hickory, palm, pili and shea, which are now listed in `fda_excluded_since_2025`. Edition 5 also widened "milk" (other ruminants) and "egg" (other fowl). There is no firm compliance date, so old labels may still say "Contains: tree nuts (coconut)". Recommendation: don't match coconut under tree nuts by default, and offer it as its own optional allergen. A web search on 2026-10-17 found no newer FDA change.

Sources:
* FDA Edition 5 guidance: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-questions-and-answers-regarding-food-allergen-labeling-edition-5
* Federal Register notice: https://www.federalregister.gov/documents/2025/01/07/2024-31533/questions-and-answers-regarding-food-allergens-including-the-food-allergen-labeling-requirements-of
* FDA food allergies: https://www.fda.gov/food/food-labeling-nutrition/food-allergies
* FARE 2025 update: https://www.foodallergy.org/fare-blog/update-fda-guidance-food-allergen-labeling
* FARE allergen pages: https://www.foodallergy.org/living-food-allergies/food-allergy-essentials/common-allergens/ (milk, egg, fish, shellfish, tree-nut, peanut, wheat, soy, sesame)

## Known gaps

1. **Almost all receipt text is synthetic** (173/176). Real-receipt transcriptions in text form are rare online (most are images), so abbreviation styles are educated guesses. Real OCR noise is not modeled beyond one hand-made "messy" receipt. Collect real receipts from the team, with PII stripped, before the demo.
2. **Category-level shelf life is coarse and conservative.** Taking the minimum across products under-estimates many items (other fresh fruit = 3 days, but apples last 4–6 weeks; dry goods = 90 days because of whole-wheat flour). Milk has no fridge number at all (FoodKeeper says "use package date"). Opened vs unopened is only partly modeled. An item-level FoodKeeper lookup would be better.
3. **The FoodKeeper copy is an Internet Archive snapshot** (2026-04-16), because the official endpoints returned 403 to us. Re-download from foodsafety.gov when you can. Item→category `examples` and allergen `added_terms` are our own editorial judgment. Tax classification (rotisserie chicken, coupons) and tax-flag letters are simplified.
* Other gaps: the rule-of-thumb mapping of hummus and deli salads to `cooked leftovers`; no Seattle stores outside the 7 listed (PCC, H Mart, WinCo); no multi-rate tax receipts; no returns or refunds; no EBT/SNAP split tender.
