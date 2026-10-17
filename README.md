# Miple

Scan your grocery receipt, and Miple tracks what's expiring, plans meals around your calendar and your health data, and texts you before food goes to waste.

```
mobile/    Expo (SDK 58) dev-build app: pantry, scan, plan, budget/Wrapped, profile. HealthKit + calendar live here.
server/    Node + Express (TypeScript): receipt OCR → Gemini normalization, recipe generation with allergen filter, chef chat, Photon nudges.
supabase/  Postgres schema, RLS, shelf-life table, cook_meal_slot() and weekly_stats.
```

## Core loop, and where it lives

| Step | What happens | Code |
|---|---|---|
| **Scan** | Photo → Perceptron OCR (or Gemini vision if Perceptron isn't configured) → Gemini normalizes "ORG SPNCH 5OZ" into *organic spinach, 5 oz, leafy_greens* → expiry = purchase date + shelf life | `server/src/routes/receipts.ts`, `mobile/src/app/(tabs)/scan.tsx`, `shelf_life` table + `items_set_expiry` trigger |
| **Plan** | Free lunch/dinner gaps for the next 3 days from the device calendar → Gemini returns structured recipes from pantry items → **code** drops anything with an allergen → ranked by urgency (50%), macro fit (30%), time fit (20%) → greedy assignment to slots. Chat with your chef to replace or skip those slots | `mobile/src/lib/calendar.ts`, `server/src/routes/recipes.ts`, `server/src/domain/allergens.ts`, `mobile/src/lib/planner.ts`, `mobile/src/app/chef.tsx` |
| **Nudge** | Daily cron: items expiring within 48h → text with the planned slot and recipe. Reply DONE / SKIP | `server/src/jobs/nudges.ts`, `server/src/routes/photon.ts` |
| **Cook** | `cook_meal_slot()` marks the slot cooked, consumes linked items, creates a 4-day leftover. The app writes the meal's macros to Apple Health | `supabase/migrations/0001_init.sql`, `mobile/src/lib/health.ts` |

Macros flow through one function, `getRemainingMacros(profile)` in `mobile/src/lib/health.ts`. It reads Apple Health when it's available and enabled, adds a workout bonus from active energy, and otherwise falls back to manual targets minus the meals cooked in Miple today. The core loop never depends on HealthKit working.

## Setup

### 1. Supabase
1. Create a project and run `supabase/migrations/0001_init.sql` in the SQL editor (or `supabase db push`).
2. In Auth → Providers, keep Email enabled. In the email template, include `{{ .Token }}` so users get a 6-digit code. The app signs in with an email OTP, so no deep links are needed.

### 2. Server
```bash
cd server
cp .env.example .env    # fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLOUD_PROJECT
npm install
npm run dev             # http://localhost:8787
npm test                # allergen filter tests
npm run nudge           # fire the daily nudge job now (dry-run logs texts if Photon isn't set)
```
A physical iPhone can't reach `localhost`, so expose the server with your LAN IP or `ngrok http 8787`.

Gemini runs on Gemini Enterprise Agent Platform (formerly Vertex AI) with Application Default Credentials, not an API key. In the Cloud project, open Agent Platform and enable the Vertex AI API (`aiplatform.googleapis.com`) if it is not already on. Give your user **Vertex AI User** (`roles/aiplatform.user`). Then:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Set `GOOGLE_CLOUD_PROJECT` to that project id. `GOOGLE_CLOUD_LOCATION` defaults to `us-central1`. On Cloud Run or GCE, the attached service account is the credential, so the `gcloud` login is only for a laptop. The model defaults to `gemini-2.5-flash` (set `MIPLE_MODEL` to change it). Structured JSON calls live in `server/src/lib/gemini.ts`.

### 3. Mobile (dev build, not Expo Go)
HealthKit breaks Expo Go, so everyone develops on the dev client from the start.

Requirements: a Mac with Xcode, an iPhone, and an Apple developer account whose team has the HealthKit capability (check this early; free personal teams have limits).

```bash
cd mobile
cp .env.example .env    # Supabase URL + anon key, server URL
npm install
npx expo run:ios --device      # local build on a Mac
# or, from any machine:
npx eas-cli@latest build --profile development --platform ios
npm start                      # Metro for the dev client
```
`app.json` already sets up the HealthKit entitlement and usage strings (via the `react-native-health` plugin), plus the calendar, camera, and photo permissions.

## ⚠️ Known risks and TODOs

- **`react-native-health` vs. New Architecture.** `expo-doctor` reports it as *unmaintained* and *untested on the New Architecture* (SDK 58 / RN 0.88). The Health owner should confirm the read and write on a device first. If it fails, swap in `@kingstinct/react-native-healthkit`. Only `mobile/src/lib/health.ts` needs to change.
- **Perceptron OCR.** Set `PERCEPTRON_API_KEY`. The adapter calls Perceptron Mk1.5 chat completions. If the key is missing or the call fails, Gemini vision reads the receipt.
- **Photon 2.0.** `server/src/lib/photon.ts` (send) and `parseInbound` (webhook) are adapters too. Without credentials, texts are logged as `[photon:dry-run]`. Point the Photon inbound webhook at `POST /photon/webhook` and set `PHOTON_WEBHOOK_SECRET`. The handler checks it against the `x-photon-secret` header.
- **Health writes after an SMS "done".** The server can't write to HealthKit. Slots cooked by text get `logged_to_health=false`, and the app syncs them the next time it's opened (`syncCookedMealsToHealth`).

## Safety and privacy (VEYZL talking points)

- **Allergens are a hard filter in code.** Allergies are loaded from the database, never from the request body. Pantry items containing an allergen are never sent to the LLM. Every generated recipe is checked against title, ingredients, steps, and the model's own allergen list (`server/src/domain/allergens.ts`, with tests).
- **Health data stays on the phone.** The API schema (`RemainingMacros` in `server/src/domain/schemas.ts`) accepts only four bounded numbers. Raw HealthKit samples, workouts, and weight never leave the device. For the before/after audit story, a "before" commit can send raw samples, and the fix restricts it to these four numbers.
- **RLS on every table.** The service-role key exists only on the server, and every server query filters by `user_id`.
- Changes go through PRs only. See `.github/pull_request_template.md`.

## Hackathon checkpoints
- **5 PM:** HealthKit read (today's dietary energy) and write (one meal) working on a device. If not, keep the manual fallback and still demo the permission prompt.
- **1 AM:** scan → pantry → recipe → calendar slot working end to end. If not, cut everything else.

## Stretch
Fridge photo scan (Perceptron object localization → `items.source = 'fridge_scan'`), shared household pantry, shareable recipes, monthly Wrapped.
