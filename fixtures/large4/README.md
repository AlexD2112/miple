# fixtures/large4 — batch 4 (synthetic, seeded)

Everything here is **synthetic** (`"synthetic": true` on every record) and generated deterministically from `SEED = 20261017`
(batch-1 `common.py`), `SEED4 = SEED + 4,000,000`, with per-area offsets (OCR +200k, calendar +300k, units +400k, household +500k;
the allergen suite is a deterministic reduction of batch 3, no RNG). Labels come only from `fixtures/shelf_life.json`,
`fixtures/allergens.json` and the app code (`server/src/domain/allergens.ts`, `mobile/src/lib/calendar.ts`,
`supabase/migrations/0001_init.sql`, `server/src/routes/receipts.ts`). Earlier batches are read, never written.

| Set | Files | Records |
|---|---|---|
| 1. Allergen regression suite | `allergen_regression/cases.json`, `allergens.regression.test.ts`, `FINDINGS.md` | 261 minimized failing cases + 65 controls |
| 2. Vision-shaped OCR output | `ocr_vision/receipts_00{0..3}.jsonl` | 3,000 receipts, 109,536 observations |
| 3. Free meal windows | `calendar_windows/cases.jsonl` | 3,000 cases, 16,967 expected windows, 19 time zones |
| 4. Unit conversion / pantry normalization | `unit_conversion/cases.jsonl`, `constants.json` | 5,000 cases |
| 5. Multi-receipt dedup / returns / split bills | `household/cases.jsonl` | 1,500 cases |
| JSON Schemas (new sets) | `schemas/*.schema.json`, `schemas/manifest.json` | 6 schemas |

Total ≈ 89 MB; largest file ≈ 18 MB.

## Regenerate / validate
```bash
cd fixtures/large4/_gen
python3 -B gen_regression.py && python3 -B gen_ocr.py && python3 -B gen_calendar.py && python3 -B gen_units.py && python3 -B gen_household.py && python3 -B gen_schemas4.py
cd .. && python3 -B validate.py        # OK {stats} / FAIL + errors; exit 0/1
# Optional cross-checks against the REAL app TypeScript (allergens.ts regression run + calendar.ts): needs TypeScript 5.
npm i --prefix /some/dir/outside/the/repo typescript@5
TS_PATH=/some/dir/outside/the/repo/node_modules/typescript python3 -B validate.py
```
**Pin `typescript@5`.** A plain `npm i typescript` now installs TypeScript 7, which has no `transpileModule` and cannot be
required as a directory. `validate.py` (and `_gen/ts_load.mjs`) read `TS_PATH/package.json` and stop with a clear
"needs typescript@5" error when another major version is found. The cross-check used Node 20 and typescript 5.9.3.

Generation is byte-identical across runs and `PYTHONHASHSEED` values. `validate.py` also re-runs **all 21 large3 schemas** (every
set in `fixtures/`, `large/`, `large2/`, `large3/`), the 6 large4 schemas, and applies the large3 receipt-item sub-schema to the
OCR ground-truth items (33,259 items).

## 1. Allergen regression suite (`allergen_regression/`)
Every batch-3 app gap (1,822 cases) reduced to the smallest single-term input that reproduces it, deduplicated by
(allergy, text) and grouped by root cause: plurals 1, missing_keyword 1, misspellings 56, unicode_normalization 60
(one per allergen × technique: zero-width, soft hyphen, NBSP, combining mark, precomposed accent, fullwidth, Cyrillic look-alike),
foreign_terms 53, compound_dishes 74, over_broad_terms 16. Each case: `findAllergens([text], [allergy])` should equal `expected`;
`app_current` is today's result. `allergens.regression.test.ts` is a `node:test` file to drop next to `allergens.ts`: gaps are `todo`
(reported, never fail CI), controls are normal tests. Verified against the real `allergens.ts`: 65 pass / 0 fail / 261 todo.
See **`FINDINGS.md`** for root causes, suggested fixes (suggestions only) and two corrections to batch 3.

## 2. OCR output simulation (`ocr_vision/`)
**App path:** the app does *not* run on-device OCR. `mobile/src/app/(tabs)/scan.tsx` uploads the photo (expo-image-picker);
`server/src/routes/receipts.ts` runs Perceptron OCR (`perceptronOcr` → plain transcription text) then Gemini, with Gemini vision as
the fallback. So each record carries both:
- `vision`: shaped like `VNRecognizeTextRequest` results — observations with `uuid`, normalized `boundingBox` and corner points
  (origin bottom-left, Vision's convention), `topCandidates` [{string, confidence}];
- `app_text`: the plain reading-order transcription the server pipeline consumes (top candidates regrouped into printed lines).
Derived from the 2,400 clean batch-1 receipts (600 of them captured twice with different conditions). Simulated issues:
column splits (name / price as separate observations), merged lines, out-of-order results (row jitter, column-major, shuffled
blocks), skew up to ±3.5°, misread top candidates (O/0, I/1, S/5, rn/m …) with the truth sometimes among lower candidates.
`ground_truth`: printed lines → observation segments (char ranges), per-observation truth text, reading order, and the parsed
`items` / store / date / total from `expected_clean.jsonl`. Coordinates, confidences and capture parameters are synthetic, not measured.
The validator checks segment coverage against the source `.txt`, bbox/corner consistency, and recovers each observation's printed
row by un-rotating its geometry.

## 3. Calendar windows (`calendar_windows/`)
Inputs mirror what `findFreeMealWindows(days, now)` sees: `device_tz`, `now`, `days`, `calendar_access` (granted / denied /
read_error), source `calendar_events` (with optional daily/weekly recurrence in the event's own zone, COUNT/UNTIL/EXDATE), and
`listed_events` — what `Calendar.listEvents` returns (occurrences overlapping `[now, rangeEnd)`; wall-clock time kept in the
event's zone, absolute duration). `expected.windows` come from the documented port `_gen/cal_port.py` (constants parsed from
`calendar.ts`; JS `Date` local-time semantics; skipped times move forward, repeated times take the earlier instant).
Kinds: DST transitions 400 (431 cases have a transition inside the range), recurring 350, overlapping 250, back-to-back 250
(gaps of 0/5/19/20/21 min), multi-day 200, crossing midnight 200, other-zone events 200, empty 200, single 200, denied 150,
fully booked 150, all-day + free/tentative 150, `now` inside/near windows 150, read error 100, other `days` values 50.
Zones include half/quarter-hour offsets (Kolkata, Kathmandu, St Johns, Chatham) and Lord Howe's 30-minute DST.
Checks: independent recomputation by interval union, invariants (20–60 min, inside the local meal window, after `now` rounded up to
15 min, no overlap with busy time, ≤ 2·days windows), and with TS_PATH the **real `calendar.ts`** (expo-calendar stubbed, one node
process per `TZ`): 3,000 / 3,000 identical, including the range passed to `listEvents`.
Observations (behaviour, not bugs): all-day events are ignored even when busy (150 cases propose meals during an all-day
"Vacation"); the first ≥ 20-min gap wins even when a ≥ 60-min gap follows in the same meal window (140 cases); windows can start
mid-minute when an event ends with seconds (8). tz data: Python zoneinfo (system tzdata 2026c) and Node ICU 2024b agree for these zones and dates.

## 4. Unit conversion (`unit_conversion/`)
Exact constants only (by definition): 1 lb = 0.45359237 kg; 1 oz = 1/16 lb; 1 US gal = 231 in³ = 3.785411784 L; fl oz = 1/128 gal;
qt/pt/cup = 1/4, 1/8, 1/16 gal (US customary cup, not the 240 mL label cup); tbsp = ½ fl oz; tsp = ⅙ fl oz; dozen = 12.
`constants.json` lists them as exact fractions with receipt aliases (`LB`, `#`, `FL OZ`, `FZ`, `GA`, `DZ` …).
Results carry `exact` (fraction), `value` (6 dp half-up) and `stored` (what `items.quantity numeric(10,2)` keeps, half away from zero).
Kinds: convert 2,000 (with a round trip through the stored value), receipt_to_pantry 1,500 (from large3 quantity cases: weight → g,
pack and size → count + content in g/mL), merge 1,000 (sum in base unit, expressed in the existing lot's unit; different
dimensions stay separate lots), invalid 500 (mass↔volume, count→mass, unknown unit, non-positive quantity).
Rule: a bare `OZ` is a mass ounce, and no density or per-item weight is ever assumed.
Findings: 73 conversions round to **0.00** when stored (e.g. 750 mg as lb), 1,011 conversions lose precision on the stored round
trip, and 26 receipt items print `OZ` on liquids (flagged `oz_on_liquid`). Storing a base unit (g/mL) would avoid most of this.

## 5. Household (`household/`)
The app has **no duplicate detection** and `public.receipts` keeps only (store, purchased_at date, total), so these rules are
this fixture's documented proposal:
- **Duplicate:** same chain (letters only, case-insensitive), same date, same total; transaction id and time must match when both
  are printed; and item names overlap (multiset Jaccard ≥ 0.6, or one list is a subset of the other — partial rescans).
  A duplicate adds no pantry lots and no budget.
  Kinds: duplicate_scan 300 (OCR-noisy rescans, lines missed), partial_rescan 100, same_day_other_trip 150 (not duplicates), and
  app_key_collision 100: the same basket bought twice in one day. The app's stored fields can't tell those apart from a duplicate.
- **Returns (450):** a return line matches an original sale by transaction reference when printed, otherwise by chain + name + unit +
  unit price (±1¢) within 90 days. The rule prefers a line whose quantity equals the returned quantity, then the earliest covering line.
  - Refund = line amount + line tax at the original rate (half-up).
  - Over-returns are rejected, and unmatched returns get no refund.
  - The pantry change is `quantity_delta`; `removes_lot` is set when the whole line is returned, since there is no 'returned' item status in the app.
  - Variants: full_line, partial_quantity, over_return, unmatched, other_location, no_txn_ref.
- **Split bills (400):** the split can be even, by percent, or by item.
  - By item: discounts follow the item they apply to, deposits follow the preceding item, and shared lines are split evenly.
  - Tax is allocated by each member's taxable amount.
  - Cents are allocated by largest remainder, with ties going to the earlier member, so the shares always sum to the receipt total.
  - Members are anonymous labels (`member_a`…).

## Schemas (`schemas/`)
Built with the large3 inference + overlay method (`_gen/gen_schemas4.py` imports `large3/_gen/gen_schemas.py` read-only):
- closed objects
- ISO date and ISO-millisecond patterns
- enums for category, availability, meal, calendar_access, line_type, root_cause and status
