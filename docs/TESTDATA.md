# Test data

Test data lives in the private repo [miple-testdata](https://github.com/AlexD2112/miple-testdata), mounted at `fixtures/`. Teammates need access to that repo.

Clone with the submodule:

```bash
git clone --recurse-submodules https://github.com/AlexD2112/miple.git
```

If the repo is already cloned:

```bash
git submodule update --init
```

Move the pin to the latest commit on the submodule's remote branch:

```bash
git submodule update --remote fixtures
```

CI needs a token or deploy key with read access to the private repo. This repository does not store that credential.

No app code references `fixtures/` yet. Drop-in tests from the large3 and large4 fixture sets, including `allergens.regression.test.ts`, live inside the data repo for the team to copy in.
