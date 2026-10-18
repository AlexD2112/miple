# Server data

These files ship with the server (and its Cloud Run image), so they live here instead of in the private `fixtures/` submodule.

## nutrition.json

About 455 common grocery items with USDA FoodData Central macros, receipt-style aliases ("BNLS CHKN BRST"), typical package sizes and a pantry category. `src/domain/nutrition.ts` uses it to attach nutrition to scanned receipt lines and to guess the category of items added by hand.

The CSV, the build scripts and the source notes are in [miple-testdata/nutrition](https://github.com/AlexD2112/miple-testdata/tree/main/nutrition). To update it, rebuild there and copy the new `nutrition.json` here.

## foodkeeper.json

613 products from the USDA FoodKeeper database (CC0), each with how many days it keeps in the fridge, pantry and freezer. Where FoodKeeper gives a range, we keep the shorter end. `src/domain/shelfLife.ts` matches an item to a product in a group that fits its category, so raw chicken never picks up cooked chicken's numbers.

To rebuild it from the FoodKeeper export in the test-data repo:

```bash
node scripts/build-foodkeeper.mjs ../fixtures/_build/foodkeeper_foodsafetygov_en_20260416.json
```

The allergen keywords in `src/domain/allergens.ts` also pull in the curated list from that repo (`bundle_small/data/small/allergen_keywords.csv`).
