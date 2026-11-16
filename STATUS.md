# Incord status

Last updated: 2026-11-16.

Production: master d98aa3f, Worker `byheart` version ff327df6 (deployed
2026-11-16 with `scripts/deploy.sh`, which generates the Jesklabs production
config). It ships the approved shared-domain, verify/split and forkable-config
refactors. Verified at deploy: `npm run verify` (625 unit tests), 457/457
Playwright, prod smoke 16/16.

The shared settings schema puts zod in the browser bundle, so
`shared/domain/settings.ts` sets `z.config({ jitless: true })`. Without it,
zod's `new Function` probe reports a CSP `script-src` violation.

## Remaining debt

Audit numbers refer to the 2026-11-16 architecture audit:

- #3: explicit practice/account/modal state machines (parked; preserve behavior).
- #7: stable tab identifiers instead of display copy (parked).
- #9: consolidate policy literals and selectively expose validated runtime policy.
- #10: typed endpoint DTOs and external-boundary validation.
- #12: focused workflow coverage beyond the pure-engine coverage threshold.
- Remove legacy Google only after a quiet operational window; preserve existing
  identity mappings and sessions until a separately reviewed migration.
