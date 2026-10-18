# Ripe

Ripe is an iOS app that turns a grocery receipt into a pantry, plans meals around the user's calendar and nutrition targets, and points them to the food they should cook before it expires. A user photographs a receipt, Ripe records each item with an estimated expiry date, and the planner schedules meals into free lunch and dinner windows using the items that will spoil first. When a meal is cooked, Ripe updates the pantry, records leftovers, and writes the meal's calories and macros to Apple Health.

The repository contains the mobile app, the API server, and the database schema. The app was renamed from Miple to Ripe; the repositories, the Cloud Run service, the iOS bundle identifier and the `miple://` sign-in scheme keep the original name because changing them would break sign-in, signing and the deployed URL. Test data lives in a separate private repository that is mounted at `fixtures/` (see [docs/TESTDATA.md](docs/TESTDATA.md)).

| Directory | Contents |
|---|---|
| `mobile/` | Expo (SDK 58, React Native 0.88) app built with Expo Router. Apple Health and the device calendar are accessed only from here. |
| `server/` | Node 22 and Express 5 API in TypeScript. It handles receipt parsing, recipe generation, the chef chat, category and shelf-life lookup, and a nightly job that marks expired items as wasted. |
| `supabase/` | Postgres migrations: tables, row-level security, the shelf-life table, and the `cook_meal_slot()` function. |
| `fixtures/` | Git submodule pointing at the private `miple-testdata` repository. |

## How it works

**Scanning.** The app uploads a receipt photo to `POST /receipts/parse`. The server identifies the image format from the file itself, because iPhone library photos arrive as HEIC even when labeled JPEG, and sends JPEG, PNG and WebP images to Perceptron for OCR, and Gemini converts the text into structured items, so a line such as `ORG SPNCH 5OZ` becomes organic spinach, 5 oz, in the `leafy_greens` category. Gemini reads the image directly when Perceptron is not configured, when the call fails, or when the photo is HEIC. The server then validates the purchase date, clamps quantities and prices, attaches USDA nutrition where the item matches the reference table, and sets each expiry date from the USDA FoodKeeper entry for that food (apples keep four weeks, bananas three days), falling back to the category's shelf life when no FoodKeeper product matches confidently. The user reviews the items before they are saved.

**Adding items by hand.** The quick-add screen picks a category from the item name as the user types, trying the USDA matcher first and asking Gemini only when the matcher has no confident answer. `POST /items/shelf-life` then sets the expiry date, preferring the FoodKeeper value and using Gemini's estimate only for foods FoodKeeper does not cover.

**Planning.** The app reads free time from the device calendar, treating busy all-day events as unavailable, and finds lunch and dinner windows. It requests recipes from `POST /recipes/generate` using the most urgent pantry items and the user's remaining macros for the day, ranks them by urgency (50%), macro fit (30%) and time fit (20%), and schedules up to 10 meals. The user can then ask the chef (`POST /recipes/chef`) to swap, add or skip a meal. The chef proposes a change, and nothing is saved until the user approves it through `POST /recipes/chef/apply`.

**Expiry.** A nightly job marks pantry items whose expiry date has passed as wasted, which feeds the weekly spending and waste summary. The app surfaces items expiring within two days at the top of the pantry.

**Cooking.** Marking a meal cooked calls `cook_meal_slot()`, which marks the meal complete, consumes the linked pantry items, and adds a four-day leftover. The app then writes the meal to Apple Health.

Nutrition targets come from one function, `getRemainingMacros()` in `mobile/src/lib/health.ts`. It reads today's intake and active energy from Apple Health when the user has enabled it, and otherwise uses manual targets minus the meals cooked in Ripe that day, so planning works without HealthKit.

## API

Every route except `/health` requires a Supabase access token in the `Authorization: Bearer` header. The one exception is audit access, described under [Safety and privacy](#safety-and-privacy).

| Route | Purpose |
|---|---|
| `GET /health` | Liveness check that also reports the model and AI routes. |
| `POST /receipts/parse` | Parses a receipt photo (multipart field `image`) into reviewable items. |
| `POST /items/category` | Returns the pantry category for an item name. |
| `POST /items/shelf-life` | Returns the category, storage and shelf life for an item name. |
| `POST /recipes/generate` | Generates allergen-safe recipes from the pantry and stores them. |
| `POST /recipes/chef` | Runs one turn of the chef chat and may return a proposed plan change. |
| `POST /recipes/chef/apply` | Saves a proposal the user approved. |

## Configuration

### Server

The server reads its settings from environment variables. Locally they come from `server/.env`, which starts as a copy of `server/.env.example`; on Cloud Run they are set on the service.

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Yes | The service-role key bypasses row-level security, so it must never reach the app. |
| `GOOGLE_CLOUD_PROJECT` | Yes | Project used for Gemini on Vertex AI. |
| `GOOGLE_CLOUD_LOCATION` | No | Defaults to `us-central1`. |
| `RIPE_MODEL` | No | Defaults to `gemini-2.5-flash`. |
| `GEMINI_THINKING_BUDGET` | No | Defaults to `0`, which turns off Gemini's thinking step and roughly halves chat and scan latency. Set `-1` to let the model decide. |
| `PERCEPTRON_API_KEY` | No | Enables Perceptron OCR. Without it, Gemini reads receipts. |
| `VEYZL_PROBE_TOKEN` | No | Enables VEYZL audits. Leave it unset to require a login on every AI route. |
| `EXPIRY_CRON`, `EXPIRY_TIMEZONE` | No | Schedule for the nightly expiry job, which defaults to 12:05 AM in `America/Los_Angeles`. |

Gemini is called through Vertex AI with Application Default Credentials rather than an API key. On Cloud Run the service account is the credential. To run the server on a laptop, enable the Vertex AI API (`aiplatform.googleapis.com`) in the project, grant yourself the Vertex AI User role, and sign in:

```bash
gcloud auth application-default login
```

```bash
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

### Mobile

`mobile/.env` holds three public values that are bundled into the app when Metro builds it: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_API_URL`. The API URL should point at the Cloud Run service so the whole team tests against the same backend, and it should point at a laptop only while someone is changing server code. Restart Metro with `npx expo start --clear` after editing the file.

### Supabase

Apply every file in `supabase/migrations/` in numeric order, either with `supabase db push` or by pasting each one into the SQL editor. Merging a migration into `main` does not change the database, so whoever deploys a release that adds one also needs to run it.

The app signs in with Google. To set that up, enable the Google provider in Supabase and create a Web OAuth client in Google Cloud whose redirect URI is `https://YOUR-PROJECT.supabase.co/auth/v1/callback`. Then add `miple://auth` to the redirect allow list under Authentication, URL Configuration.

## Development

```bash
cd server
npm install
npm run dev
```

The server listens on port 8787, and `npm run expire-items` runs the nightly expiry job once for testing.

The app uses a development build rather than Expo Go, because HealthKit is not available in Expo Go. Building for a device requires a Mac with Xcode and an Apple ID. Free Apple accounts can use HealthKit, although apps signed with them stop launching after about seven days.

```bash
cd mobile
npm install
npx expo run:ios --device
```

`npm start` then serves the JavaScript bundle to the development build. For a build that runs without a computer attached, use `npx expo run:ios --device --configuration Release`.

## Testing

`npm test` in `server/` runs the full server suite, which includes the 326-case allergen regression suite from the test-data repository, and `npm run typecheck` checks types in either package. The 103-case calendar regression suite runs from `mobile/`:

```bash
../server/node_modules/.bin/tsx --test src/lib/calendar.regression.test.ts
```

CI should install dependencies with `npm ci`, which fails when `package-lock.json` has drifted from `package.json` instead of quietly resolving new versions.

## Deployment

The API runs on Cloud Run as the `miple-api` service in `us-central1`, at `https://miple-api-1035155285280.us-central1.run.app`. The service keeps one instance warm and has CPU allocated outside requests, which the nightly expiry job needs.

```bash
gcloud run deploy miple-api --source server --region us-central1
```

That command uploads the local `server/` folder, uncommitted changes included, so releases should be deployed only from a clean checkout of `main`. A separate worktree is the simplest way to guarantee that:

```bash
git worktree add --detach ../miple-deploy origin/main
```

Environment variables persist across deploys and are changed with `gcloud run services update miple-api --region us-central1 --update-env-vars NAME=value`. When a release includes a migration, apply it to Supabase before deploying the server.

## Safety and privacy

**Allergens are enforced in code.** The server loads allergies from the database rather than from the request, removes allergen-containing pantry items before the model sees them, and rejects any generated recipe whose title, ingredients or steps contain an allergen. The matcher in `server/src/domain/allergens.ts` recognizes misspellings, foreign names, dishes that hide allergens, look-alike characters, and dairy-free or gluten-free labels.

**Chat guardrails run before and after the model.** `server/src/domain/guard.ts` answers requests for secrets, jailbreak attempts, personal-data extraction, ID-document reading and face-based trait inference with fixed replies that never reach Gemini. It also redacts emails, phone numbers, card numbers and credentials from every reply, and the chef's instructions limit it to cooking and food topics.

**Health data stays on the phone.** The API accepts only four bounded numbers derived from Apple Health: remaining calories, protein, carbohydrates and fat. Raw samples, workouts and body weight never leave the device.

**Access is scoped.** Every table has row-level security, the service-role key exists only on the server, and every server query filters by the authenticated user. VEYZL audits reach the AI routes only with `VEYZL_PROBE_TOKEN`, sent either as a bearer token or as the path prefix `/audit/<token>`, and a wrong token returns 404.

All changes go through pull requests, which VEYZL audits automatically.

## Known limitations

- Expiry dates are estimates from USDA FoodKeeper or the food category, not dates read from the package, so users can adjust them in the pantry.
- The app supports iOS only because it depends on HealthKit, and an Android version would need Health Connect.
