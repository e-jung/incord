# Incord status

Last updated: 2026-11-17.

Production: master 47190dd, Worker `byheart` version f65077e8 (deployed
2026-11-17 with `scripts/deploy.sh`). It adds group-join fixes found in a
production group test: unnamed users give a name before they join or create a
group (owners no longer see "Approve Friend"), a signed-out invite link shows one
"Sign in to join" action, an approval-required join shows "Your join requests",
and a remembered group's detail is fetched only after the list confirms
membership. Verified: `npm run verify` (625 unit tests), Playwright 177/177/109
(iPhone15-light/dark, WebKit), CI green, and a two-account production group test
16/16 on Chromium and WebKit.

Previous: master d98aa3f, version ff327df6 (2026-11-16): the approved
shared-domain, verify/split and forkable-config refactors.

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
