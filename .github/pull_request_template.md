## Summary

<!-- What this change does and why it is needed. -->

## Testing

<!-- How you verified it: tests run, devices used, manual steps. -->

## Checklist

- [ ] Allergen filtering stays in code (`server/src/domain/allergens.ts`), and nothing relies on the model to avoid allergens.
- [ ] Only `RemainingMacros` leaves the device, and no raw HealthKit data is sent to the server.
- [ ] New tables have row-level security policies, and any new migration is called out for whoever deploys.
- [ ] `npm test` and `npm run typecheck` pass in `server/`, and `npm run typecheck` passes in `mobile/`.
- [ ] `package-lock.json` is committed with any dependency change.
