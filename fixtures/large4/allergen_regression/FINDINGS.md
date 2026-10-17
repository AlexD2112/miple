# Allergen matcher findings (server/src/domain/allergens.ts)

Source: every `app_false_negative` / `app_false_positive` in `fixtures/large3/llm_safety/cases.jsonl` (1,822 cases), each reduced
to the smallest single-term input that reproduces it, then deduplicated → **261 regression cases** in `cases.json` /
`allergens.regression.test.ts`, plus **65 controls** the app already gets right. All synthetic. Suggestions only; no app code was changed.

How the matcher works today: `texts.join(" \n ").toLowerCase()` tested against `/\b(kw1|kw2|…)(e?s)?\b/i` per allergen.
`\b` in JavaScript is ASCII-only (`[A-Za-z0-9_]`), which drives several of the issues below.

| Root cause | Cases | Example (text / allergy) |
|---|---|---|
| plurals | 1 | `anchovies` / fish |
| missing_keyword (compound word) | 1 | `soybeans` / soy |
| misspellings | 56 | `penuts` / peanut, `parmasan` / milk, `soysauce` / gluten |
| unicode_normalization | 60 | `e\u200bggs` / egg, `ｃｏｄ` / fish, `pеanuts` (Cyrillic е) / peanut |
| foreign_terms | 53 | `leche` / milk, `garnelen` / shellfish, `shoyu` / soy |
| compound_dishes | 74 | `caesar dressing` / fish, `teriyaki sauce` / wheat, `pad thai` / peanut, `naan` / milk |
| over_broad_terms (false positives) | 16 | `coconut milk` / milk, `cream of tartar` / milk, `rice noodles` / wheat |

## Root causes and suggested fixes

1. **Plurals (`y → ies`).** `(e?s)?` only adds `s`/`es`, so `anchovy` never matches `anchovies` (same for `berries`-style plurals of
   future keywords). *Fix:* add an `ies` alternative for keywords ending in `y` (e.g. generate `anchov(y|ies)`), or list irregular plurals explicitly.
2. **Compound words.** `soy` followed by more letters (`soybeans`, `soybean oil`) fails the trailing `\b`. *Fix:* add `soybean` to the soy list;
   review other keywords that commonly prefix a compound (`peanutbutter`, `wheatflour`, `soysauce` show the same effect in the misspellings group).
3. **Unicode normalization.** Zero-width space, soft hyphen, NBSP, combining accents, precomposed accents, fullwidth letters and Cyrillic
   look-alikes all break the ASCII `\b` / literal match. *Fix:* before matching, `text.normalize("NFKC")`, then `normalize("NFD")` and strip
   `\p{M}` (marks) and `\p{Cf}` (format chars incl. U+200B, U+00AD); map or reject mixed-script tokens (a confusables table, or treat any
   non-Latin letter inside a Latin word as suspicious → reject). Consider the `u` flag with `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])` instead of `\b`.
4. **Misspellings.** LLM/OCR typos (`penuts`, `cheeze`, `tahinni`). *Fix (pick one):* a small alias list for the common ones, or a fuzzy
   token match (Damerau-Levenshtein ≤ 1 for tokens ≥ 5 chars) that only *adds* hits — and only for this safety filter, since a false positive is the safe direction.
5. **Foreign terms.** No non-English keywords. *Fix:* multilingual aliases per allergen (the 49-entry table in
   `large3/llm_safety/lookup_tables.json` is a starting point), and/or require the LLM to return English ingredient names and rely on
   `declared_allergens` (already checked first) — but don't trust declarations alone.
6. **Compound dishes.** Dish/sauce names hide allergens (`caesar dressing`→anchovy/egg/parmesan, `teriyaki`→soy sauce→wheat, `naan`→yogurt/ghee).
   `pesto` and `soy sauce` are already handled this way. *Fix:* extend that approach with a dish → allergen table (treat as an assumption:
   a match should *reject or warn*, since real recipes vary), and prompt the LLM to list sub-ingredients of sauces.
7. **Over-broad terms (false positives).** `milk`/`butter`/`cream`/`yogurt` inside `coconut milk`, `oat milk`, `cocoa butter`,
   `sunflower seed butter`, `cream of tartar`, `coconut yogurt`, `dairy-free butter`; `noodle`/`flour`/`tortilla`/`pasta` inside
   `rice noodles`, `rice flour`, `corn tortillas`, `gluten-free pasta`; `peanut` in `peanut-free`. *Fix:* an exception list of multi-word
   safe phrases removed before matching, plus "`<allergen>`-free" negation. Keep this list short and explicit: a false positive only drops a safe recipe.

## Corrections to batch 3
- **Not regressions (reference was silent):** generic `bread`/`loaves of bread`, `noodles`, `tortillas` were labelled `app_false_positive` in batch 3
  only because `allergens.json` has no entry for them. They usually do contain wheat; the app flagging them is correct. Listed under
  `reference_silent` in `cases.json` (4 groups, 7 source cases) and excluded from the suite.
- **Withdrawn trap:** `buckwheat noodles` (soba) frequently contains wheat flour, so the batch-3 "trap" label (no wheat/gluten) is withdrawn
  (`reference_disputed`); the app's match should stay.

## Using the suite
Copy `allergens.regression.test.ts` next to `server/src/domain/allergens.ts` and run `npm test` in `server/`. Known gaps are `todo`
tests (reported, never fail CI); controls are normal tests. When a fix lands, drop the `todo` option for that group.
Verified against the real `allergens.ts`: 65 pass, 0 fail, 261 todo (`_gen/check_regression_ts.mjs`, needs `typescript@5`).
