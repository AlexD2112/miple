# Server runtime data

`nutrition.json` maps about 455 common grocery items to USDA FoodData Central macros, receipt-style aliases, typical package sizes and shelf-life categories. `src/domain/nutrition.ts` loads it to attach nutrition to scanned receipt lines and to choose categories for items added by hand. The file ships inside the server and its Cloud Run image, which is why it lives here rather than in the private `fixtures/` submodule.

The CSV version, the build scripts, the source notes and a draft storage-aware `shelf_life.json` are in the [miple-testdata](https://github.com/AlexD2112/miple-testdata/tree/main/nutrition) repository. To update the table, rebuild it there and copy the new `nutrition.json` into this folder.

`foodkeeper.json` holds 613 products from the USDA FSIS FoodKeeper database (CC0), each with fridge, pantry and freezer life in days. `src/domain/shelfLife.ts` matches an item to one product within groups that fit its category and uses that product's value for its usual storage, keeping the shorter end of every range. It is rebuilt from the FoodKeeper export in the test-data repository:

```bash
node scripts/build-foodkeeper.mjs ../fixtures/_build/foodkeeper_foodsafetygov_en_20260416.json
```

The allergen keywords in `src/domain/allergens.ts` include the curated list from the same repository (`bundle_small/data/small/allergen_keywords.csv`).
