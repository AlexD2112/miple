# Test data

Test fixtures, research and reference datasets live in the private [miple-testdata](https://github.com/AlexD2112/miple-testdata) repository, which this repository mounts as a Git submodule at `fixtures/`. Contributors need read access to that repository, but the app and the server do not use it at runtime.

To clone both repositories at once:

```bash
git clone --recurse-submodules https://github.com/AlexD2112/miple.git
```

To fetch the submodule in an existing clone:

```bash
git submodule update --init
```

The submodule is pinned to a specific commit. To move the pin to the latest commit on the data repository's default branch, run the command below and commit the updated pointer:

```bash
git submodule update --remote fixtures
```

CI needs a token or deploy key with read access to the private repository, and this repository does not store one.

## What comes from the data repository

Two regression suites from the data repository are copied into this one and run as ordinary tests. `server/src/domain/allergens.regression.test.ts` comes from `large4/allergen_regression` and covers 326 allergen cases, and `mobile/src/lib/calendar.regression.test.ts` comes from `large5/calendar_regression` and covers 103 calendar cases. The server's nutrition table, `server/data/nutrition.json`, is built with the scripts in the data repository's `nutrition/` folder. The rest of the data repository, including the research exports and the market-sizing bundle, is reference material that the code does not read.
