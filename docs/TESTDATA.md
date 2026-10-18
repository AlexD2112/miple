# Test data

Test fixtures, research and reference data live in the private [miple-testdata](https://github.com/AlexD2112/miple-testdata) repo, mounted here as a git submodule at `fixtures/`. You need access to that repo to run the regression data builders, but the app and server never read it at runtime.

Clone both at once:

```bash
git clone --recurse-submodules https://github.com/AlexD2112/miple.git
```

Or, in a clone you already have:

```bash
git submodule update --init
```

The submodule is pinned to one commit. To move it to the latest data, run this and commit the new pointer:

```bash
git submodule update --remote fixtures
```

CI will need a token or deploy key that can read the private repo. This repo doesn't store one.

## What we use from it

Two regression suites are copied into this repo and run as normal tests:

- `server/src/domain/allergens.regression.test.ts`: 326 allergen cases, from `large4/allergen_regression`
- `mobile/src/lib/calendar.regression.test.ts`: 103 calendar cases, from `large5/calendar_regression`

The server's USDA tables in `server/data/` are built from the data repo too (see `server/data/README.md`). Everything else there, such as the competitor research and market sizing, is reference material for the team and the pitch.
