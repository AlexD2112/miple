# Server runtime data

`nutrition.json` maps about 455 common grocery items to USDA FoodData Central macros, receipt-style aliases, typical package sizes and shelf-life categories. `src/domain/nutrition.ts` loads it to attach nutrition to scanned receipt lines and to choose categories for items added by hand. The file ships inside the server and its Cloud Run image, which is why it lives here rather than in the private `fixtures/` submodule.

The CSV version, the build scripts, the source notes and a draft storage-aware `shelf_life.json` are in the [miple-testdata](https://github.com/AlexD2112/miple-testdata/tree/main/nutrition) repository. To update the table, rebuild it there and copy the new `nutrition.json` into this folder.
