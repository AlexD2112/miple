# fixtures/large3 — batch 3 (synthetic, seeded)

Everything here is **synthetic** (`"synthetic": true` on every record) and generated deterministically from
`SEED = 20261017` (batch-1 `common.py`), `SEED3 = SEED + 3,000,000`, with per-area offsets
(llm_safety +100k, pantry +200k, quantity +300k, ranking +400k). No real receipts, people or stores' private data.
Labels come only from `fixtures/shelf_life.json`, `fixtures/allergens.json`, and app code
(`server/src/domain/allergens.ts`, `server/src/schemas.ts`, `supabase/migrations/0001_init.sql`, `mobile/src/lib/*`).
Keyword lists and shelf-life days are **parsed from those files at generation time**, not transcribed.

| Set | Files | Records |
|---|---|---|
| LLM-output allergen safety | `llm_safety/cases.jsonl`, `llm_safety/lookup_tables.json` | 5,150 cases |
| Pantry state over time | `pantry_sequences/sequences_00{0,1,2}.jsonl` | 3,000 sequences, 96,670 events, 10,595 checkpoints |
| Quantity / unit / price parsing | `quantity_parsing/cases.jsonl` | 10,000 lines |
| Expiring-soon ranking | `expiry_ranking/cases.jsonl` | 3,000 cases, 46,960 items |
| JSON Schemas (all batches) | `schemas/*.schema.json`, `schemas/manifest.json` | 21 schemas, 113,950 records checked |

Largest file ≈ 19.8 MB; set total ≈ 57.6 MB.

## Regenerate / validate
```bash
cd fixtures/large3/_gen
python3 -B gen_llm_safety.py && python3 -B gen_pantry_seq.py && python3 -B gen_qty.py && python3 -B gen_ranking.py && python3 -B gen_schemas.py
cd .. && python3 -B validate.py            # prints OK {stats} or FAIL + errors, exit code 0/1
# optional: cross-check against the REAL allergens.ts (needs the typescript package somewhere outside the repo)
TS_PATH=/path/to/node_modules/typescript python3 -B validate.py
```
Generators import batch-1/2 helpers read-only from `../large/_gen` and `../large2/_gen` (nothing there is modified).
Output is byte-identical across runs and across `PYTHONHASHSEED` values.

## 1. LLM-output safety (`llm_safety/`)
Each case is a `RecipeDraft` (shape of `schemas.ts`) plus an `allergies` profile (app keys, or a free-text unknown allergy).
- `expected_verdict` (`reject` / `caution` / `allow`) + `expected_offending` — **reference label**: batch-1 matcher over
  `allergens.json` applied to the canonical ingredients, **plus the compound-dish expansions in `lookup_tables.json`**.
  Rules: declared allergen in `declared_allergens` ⇒ reject; `may_contain` only ⇒ caution; mollusks count as shellfish
  (app's shellfish keyword list includes them); gluten = wheat terms or app gluten-only words (barley, rye, malt, farro, spelt);
  unknown allergies match literally.
- `app_verdict` / `app` — what the app's `violatesAllergies` returns (Python port in `_gen/app_allergens.py`,
  verified 5,150/5,150 against the transpiled real `allergens.ts` by `_gen/app_allergens_check.mjs`).
- `gap` — `app_false_negative` / `app_false_positive` / null; these are the cases that are meant to fail today.
- Kinds: plain_positive 600, plain_negative 500, hidden_compound 950, misspelling 600, plural 300, case 250,
  unicode 500 (fullwidth, zero-width, homoglyph, NBSP, combining marks), foreign_language 500, steps_only 250,
  declared_only 200, false_positive_trap 400, unknown_allergy 100.
- **Documented assumptions**: `lookup_tables.json` → `expansions` (50: pesto, teriyaki, worcestershire, caesar dressing,
  pad thai, naan, soy sauce, oyster sauce, parmesan, pasta/spaghetti …), `foreign` (49), `misspellings` (25), `plurals` (29),
  `traps` (19). Expansions describe *typical* recipes, not every product — treat them as assumptions, not facts.
- Verdicts: reject 4,090 / allow 1,004 / caution 56. Gaps: app_false_negative 1,738, app_false_positive 84.

## 2. Pantry sequences (`pantry_sequences/`)
Events per day: `receipt` (duplicate lines on one receipt merge into one lot per name+unit), `leftover`, `consume`,
`discard_expired`, `discard_lot`. Rules:
- Lot expiry = purchase_date + `shelf_life.json` default-storage days (fallback: app `shelf_life` table; `expiry_source` says which).
- A lot is expired on day d when `expiry < d`. Consumption is **first-expiring-first** over non-expired active lots;
  ties → earlier purchase_date → lot_id. Quantity 0 ⇒ `used`; discarded ⇒ `wasted`. Unmet consumption is a recorded `shortfall`.
- Checkpoints (after the day's events): active_lots with days_left, totals by `name|unit`, expired_active_lot_ids,
  next_to_use, used/wasted totals, status_counts.

## 3. Quantity parsing (`quantity_parsing/`)
Line text → `quantity, unit, unit_price, gross_total, discount_total, line_total` (+ `pack`, `size`, `deal`, `weight_embedded`,
and `app_quantity` / `app_unit` as stored on a `ParsedReceipt` item). Types: unit_single, qty_at (`2 @ 3.99`), weight
(`1.32 lb @ 2.99/lb`), deal_n_for (`3/$5`), bogo, pack (`12 CT`), size_in_name (`64 FL OZ`, `0.5 GAL`), upc_embedded,
plu_weight, costco_tpd, n_ea (`1 EA`), rounding_edge (exact half cents).
- Money: round-half-up to cents. Deals: per_unit = round(deal_price/n); line = (q // n)·deal_price + (q % n)·per_unit.
- Embedded-price UPC: `2-IIIII-PPPPP-C`, price in cents, standard UPC-A check digit. PLUs 3000–4999 are synthetic placeholders.
- App quantity: weight items → (weight, lb/kg); packs → (q·count·[size if ct], ct); size in name → (size·q, size unit);
  single unsized item → (1, null); else (q, ea).

## 4. Expiring-soon ranking (`expiry_ranking/`)
Pantry in mobile `Item` shape. Ranked: `status=active`, quantity > 0, known expiry with days_left ≥ 0 (calendar days, as `daysUntil`).
**Use-first order**: days_left ↑, then app shelf-life days of the category ↑ (more perishable first), then purchase_date ↑,
then name (casefold) ↑, then id ↑. Expired, unknown-expiry and excluded items are listed separately. Also `top3`,
`expiring_within` {0,1,3,7} and the planner's urgency `1/(1+max(0,days))`. Includes leap-day, year-end and DST dates and
exact duplicates differing only by id.

## 5. Schemas (`schemas/`)
One draft 2020-12 schema per fixture set in `fixtures/` (curated), `large/`, `large2/`, `large3/` — see `manifest.json`.
Structure is inferred from the data (closed objects, keys required when present in every record, map-like objects as
`additionalProperties`), overlaid with constraints from shelf_life.json/app code: category enums, app category keys,
storage/status/verdict enums, `YYYY-MM-DD` date patterns. `validate.py` checks every record of every set with a built-in
subset validator (type, enum, pattern, properties, required, additionalProperties, items) — no dependencies.

## App findings surfaced by these fixtures
- `violatesAllergies` misses `anchovies` and `soybeans` (the `(e?s)?` suffix + word boundary doesn't cover these plurals).
- Misses misspellings, foreign-language terms, unicode tricks, and compound dishes (teriyaki, caesar dressing, pad thai, naan…).
- False positives: coconut milk, cream of tartar, cocoa butter, rice/buckwheat noodles, corn tortillas, gluten-free pasta,
  sunflower seed butter, generic noodles/tortillas.
- `allergens.json` has no parmesan/feta milk terms (covered here via expansions).
