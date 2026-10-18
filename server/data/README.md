# Server runtime data

`nutrition.json` is loaded by `src/domain/nutrition.ts` to attach USDA macros to receipt lines. It ships with the server (and the Cloud Run image), so it lives here rather than in the private `fixtures/` submodule.

The CSV version, the build scripts (`scripts/build_nutrition.py` + FoodData Central downloads), the source notes and the draft `shelf_life.json` are in [miple-testdata](https://github.com/AlexD2112/miple-testdata/tree/main/nutrition). Rebuild there and copy the new `nutrition.json` here.
