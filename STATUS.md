# Incord status

Last updated: 2026-11-16.

Production remains origin/master at 7cd9055 until review and deployment. This
branch implements the approved shared-domain, verification/splitting and forkable
configuration refactors; it must not be represented as deployed.

## Remaining debt

Audit numbers refer to the 2026-11-16 architecture audit:

- #3: explicit practice/account/modal state machines (parked; preserve behavior).
- #7: stable tab identifiers instead of display copy (parked).
- #9: consolidate policy literals and selectively expose validated runtime policy.
- #10: typed endpoint DTOs and external-boundary validation.
- #12: focused workflow coverage beyond the pure-engine coverage threshold.
- Remove legacy Google only after a quiet operational window; preserve existing
  identity mappings and sessions until a separately reviewed migration.
