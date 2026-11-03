# Ripe

Ripe is an iOS app for people who buy groceries and then forget about them. You photograph a receipt, Ripe adds everything to your pantry with an expiry date, and it plans meals into the free time on your calendar, starting with whatever will go bad first. When you cook, it updates the pantry, keeps track of leftovers, and logs the meal. It is also a full calorie and macro tracker: you can log anything you eat, cooked or not, and Ripe sets your targets from your own intake and weight trend, the way MacroFactor does. A browser version runs at [ripe.cooking](https://ripe.cooking).

The app used to be called Miple. Anything users see now says Ripe, but the repositories, the Cloud Run service, the iOS bundle ID and the `miple://` sign-in link still use the old name, because renaming them would break sign-in, code signing and the server URL.

```
mobile/     Expo app (SDK 58, React Native 0.88, Expo Router)
server/     Node 22 + Express 5 API in TypeScript
supabase/   Postgres migrations
fixtures/   private test data (git submodule, see docs/TESTDATA.md)
```

## How it works

### Scanning a receipt

The app sends the photo to `POST /receipts/parse`. Perceptron reads the text and Gemini turns each line into an item, so `ORG SPNCH 5OZ` becomes organic spinach, 5 oz, filed under leafy greens. If Perceptron isn't set up or fails, Gemini reads the photo itself. It also handles HEIC photos directly, because iPhone library photos arrive in that format even when the app labels them JPEG.

Before anything is saved, the server checks the receipt date and clamps impossible quantities and prices. It then looks each item up in two USDA tables, one for nutrition and one for shelf life (FoodKeeper). That's why apples get four weeks and bananas get three days. Foods FoodKeeper doesn't know fall back to a per-category shelf life. The user reviews the list before it goes into the pantry.

### Adding something by hand

Quick add guesses the category as you type, using the USDA table first and Gemini only when that comes up empty. `POST /items/shelf-life` then picks the expiry date the same way: FoodKeeper when it has the food, Gemini's estimate when it doesn't.

### Planning meals

The app reads your calendar, skips busy all-day events, and finds free lunch and dinner windows. It asks `POST /recipes/generate` for recipes built from your most urgent pantry items and the calories and macros you have left today. It then scores them on urgency (50%), macro fit (30%) and time fit (20%) and fills up to 10 slots.

You can then talk to the chef (`POST /recipes/chef`) to swap, add or skip a meal. The chef only proposes changes. Nothing is saved until you approve it, which goes through `POST /recipes/chef/apply`. If you ask for something that clashes with your allergies, diet or dislikes, the chef says so up front and suggests an alternative. Two checks feed that warning. Keyword lists run in code, and a second, smaller Gemini call reviews your message for hidden ingredients (pad see ew has soy sauce) while the chef is still writing. That check usually finishes first, so it adds no wait, and a clean result or a failed call is simply ignored.

### Cooking and expiry

Marking a meal cooked runs `cook_meal_slot()` in Postgres. It uses up the linked pantry items, adds a four-day leftover, and the app logs the meal to Apple Health. Every night a job marks anything past its expiry date as wasted, which is where the weekly "Wrapped" waste count comes from.

Remaining macros come from `getRemainingMacros()` in `mobile/src/lib/health.ts`. With Apple Health on, it reads what you've eaten and burned today. Without it, it adds up today's food log (below), so planning works either way.

### Logging food

The Log tab is a food diary: each day's food by meal, with calories and macros against your targets. Cooked plan meals land there automatically (one row per meal, so cooking twice can't count twice). The add screen (`log-food`) offers:

- **Meal photo.** `POST /food/estimate` asks Gemini for each part of the plate with a portion, grams and macros. The server clamps silly values and, when the calories disagree with 4/4/9 from the macros by more than 25%, trusts the macros (`server/src/domain/food.ts`). You review and resize each item before it is logged.
- **Nutrition label.** The same route reads a Nutrition Facts panel exactly, per printed serving.
- **Describe it.** Typed text like "2 eggs, toast with butter, black coffee" goes to the same route.
- **Barcode.** The camera (expo-camera) or a typed number calls `GET /food/barcode/:code`, which looks the product up on Open Food Facts.
- **Search.** `GET /food/search?q=` matches the USDA table already used for receipts, per 100 g as bought, plus your own past foods.
- **Quick add** for plain numbers, and **Recent** foods to log again in one tap. A day with nothing logged can copy the day before.

Entries live in `food_log` (migration 0005) with macros per serving. With Apple Health on, each entry is also written there, tagged with its id so edits and deletes can remove it again. Without Apple Health, the food log is what `getDailyIntake()` uses, so the measured expenditure and auto targets on the Me tab work without it, including on the web.

### Shopping list

The Groceries tab has a shopping list (`shopping_list`, migration 0005). You can type items ("eggs, oat milk, 2 lb chicken" adds three), photograph a handwritten or printed list (`POST /shopping/scan-list`), or add the Buy next picks. Ingredients the chef says you need are added too. Checked items can be moved to the pantry in one tap.

## API

All routes except `/health` need a Supabase access token as `Authorization: Bearer <token>`. VEYZL's audit access is the one exception (see [Safety and privacy](#safety-and-privacy)).

| Route | What it does |
|---|---|
| `GET /health` | Liveness check; also reports the model in use |
| `POST /receipts/parse` | Turns a receipt photo (multipart field `image`) into items to review |
| `POST /items/category` | Pantry category for an item name |
| `POST /items/shelf-life` | Category, storage and shelf life for an item name |
| `POST /recipes/generate` | Builds allergen- and diet-safe recipes from the pantry |
| `POST /recipes/chef` | One turn of the chef chat; may include a proposed change |
| `POST /recipes/chef/apply` | Saves a change the user approved |
| `POST /food/estimate` | Calories and macros from a meal photo, a nutrition label (multipart `image`) or a description (`text`) |
| `GET /food/barcode/:code` | Product nutrition from Open Food Facts |
| `GET /food/search?q=` | USDA foods matching a search, per 100 g |
| `POST /shopping/scan-list` | Items from a photo of a shopping list (multipart `image`) |

## Configuration

### Server

Settings are environment variables. Locally, copy `server/.env.example` to `server/.env`. On Cloud Run they're set on the service.

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Yes | The service-role key bypasses row-level security. Never put it in the app. |
| `GOOGLE_CLOUD_PROJECT` | Yes | Project used for Gemini on Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | No | Default `us-central1` |
| `RIPE_MODEL` | No | Default `gemini-2.5-flash` |
| `GEMINI_THINKING_BUDGET` | No | Default `0` (thinking off), which roughly halves chat and scan time. `-1` lets the model decide. |
| `SAFETY_MODEL` | No | Model for the allergy and diet check that runs next to each chef reply. Default `gemini-2.5-flash-lite` |
| `PERCEPTRON_API_KEY` | No | Turns on Perceptron OCR |
| `VEYZL_PROBE_TOKEN` | No | Turns on VEYZL audits. Leave empty to require a login everywhere. |
| `EXPIRY_CRON`, `EXPIRY_TIMEZONE` | No | Nightly expiry job; default 12:05 AM Los Angeles time |

Gemini runs on Vertex AI with Application Default Credentials, not an API key. Cloud Run uses its service account. To run the server on a laptop, enable the Vertex AI API (`aiplatform.googleapis.com`) and give yourself the Vertex AI User role, then sign in:

```bash
gcloud auth application-default login
```

```bash
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

### Mobile

`mobile/.env` has three public values that get baked into the app: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_API_URL`. Keep the API URL pointed at Cloud Run so everyone tests the same backend, and only point it at a laptop while you're working on server code. After editing the file, restart Metro with `npx expo start --clear`.

### Supabase

Run the files in `supabase/migrations/` in order, with `supabase db push` or by pasting them into the SQL editor. Merging a migration doesn't touch the database, so whoever ships a release with a new one has to run it.

Sign-in uses Google. Turn on the Google provider in Supabase, create a Web OAuth client in Google Cloud with the redirect URI `https://YOUR-PROJECT.supabase.co/auth/v1/callback`, and add `miple://auth` to the redirect allow list (Authentication → URL Configuration). The web app also needs `https://ripe.cooking` on that list, plus `http://localhost:8081` if you want to sign in to a local web build.

## Running it locally

```bash
cd server
npm install
npm run dev
```

The server runs on port 8787. `npm run expire-items` runs the nightly expiry job once.

The app needs a development build, since HealthKit doesn't work in Expo Go. You'll need a Mac with Xcode and an Apple ID. A free Apple ID works, including HealthKit, but the build stops opening after about a week.

```bash
cd mobile
npm install
npx expo run:ios --device
```

After that, `npm start` serves the JavaScript to the development build. For a copy that runs without the laptop, build with `npx expo run:ios --device --configuration Release`.

## Tests

`npm test` in `server/` runs everything on the server side, including a 326-case allergen suite from the test-data repo. `npm run typecheck` works in both packages. The 103-case calendar suite runs from `mobile/`:

```bash
../server/node_modules/.bin/tsx --test src/lib/calendar.regression.test.ts
```

Use `npm ci` in CI. It fails if `package-lock.json` has drifted from `package.json`, which is exactly what you want to catch.

## Deploying

The API is the `miple-api` Cloud Run service in `us-central1`, at `https://miple-api-1035155285280.us-central1.run.app`. It keeps one instance warm, with CPU on between requests so the nightly job can run.

```bash
gcloud run deploy miple-api --source server --region us-central1
```

That command uploads your local `server/` folder as it is, uncommitted edits included, so only deploy from a clean copy of `main`. A throwaway worktree is the easy way:

```bash
git worktree add --detach ../miple-deploy origin/main
```

Environment variables survive deploys. Change them with `gcloud run services update miple-api --region us-central1 --update-env-vars NAME=value`. If a release includes a migration, run it on Supabase before deploying the server.

### Web app

The same Expo app also builds for the browser and is hosted on Firebase Hosting at `https://ripe.cooking`, in the same Google Cloud project as the API. Sign-in is the same Google login, done as a full-page redirect instead of the in-app browser. Apple Health and the device calendar don't exist in a browser, so the web app uses manual targets, plans as if your calendar were free, and turns "Add to calendar" into a Google Calendar link. The API only answers browsers from the origins in `WEB_ORIGINS` (by default `ripe.cooking`, `www.ripe.cooking` and `localhost:8081`).

To publish a new version, build with the same `mobile/.env` the phone app uses and deploy from the repository root:

```bash
cd mobile && npm run build:web && cd ..
npx firebase-tools deploy --only hosting
```

## Safety and privacy

Allergies are enforced in code, not left to the model. The server reads them from the database, never from the request. It keeps allergen items out of what Gemini sees and throws away any recipe whose title, ingredients or steps mention one. The matcher (`server/src/domain/allergens.ts`) catches misspellings, foreign names, dishes that hide allergens such as caesar dressing, look-alike characters, and "dairy-free" style labels. Diets like vegetarian, vegan, pescatarian, halal and kosher are enforced the same way.

The chef has guardrails on both sides of the model. `server/src/domain/guard.ts` answers jailbreaks, requests for secrets or personal data, ID-document reading and face-based guesses about people with fixed replies that never reach Gemini. It also scrubs emails, phone numbers, card numbers and keys from every reply.

Health data stays on the phone. The server only ever receives four numbers from it: remaining calories, protein, carbs and fat. Food you log in Ripe is stored in Supabase like planned meals, because it's your own entry rather than a HealthKit sample. Weigh-ins and the weight goal stay on the phone.

Every table has row-level security, the service-role key lives only on the server, and every query is scoped to the signed-in user. VEYZL can reach the AI routes only with `VEYZL_PROBE_TOKEN`, as a bearer token or the path prefix `/audit/<token>`. A wrong token gets a 404. All changes go through pull requests, which VEYZL audits.

## Known limitations

- Expiry dates are estimates from USDA FoodKeeper or the food category, not read off the package, so users can edit them.
- Photo and description numbers are estimates, so the review screen lets you resize or fix each item before it's logged.
- Food search covers the 455 common foods in the USDA table plus your own history. Branded foods come from barcodes (Open Food Facts), which doesn't list every product.
- Barcode scanning needs an iOS build that includes expo-camera; older builds and browsers without the BarcodeDetector API can type the number instead.
- iOS only, because of HealthKit. Android would need Health Connect. The web app has no Health or calendar access.
