## What

## Why

## Checklist
- [ ] No allergen logic delegated to the LLM (filters live in `server/src/domain/allergens.ts`)
- [ ] No raw HealthKit data leaves the device (only `RemainingMacros`)
- [ ] New tables have RLS policies
- [ ] `npm run typecheck` passes in `server/` and `mobile/`
