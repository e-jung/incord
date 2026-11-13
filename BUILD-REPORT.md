# By Heart — build report

Completed locally on 2026-11-13. No GitHub remote, push, or Cloudflare deployment.

## What's built

- Svelte 5 / TypeScript mobile PWA matching the soft-tactile design C, with System/Light/Dark appearances, self-hosted Figtree/Literata, reusable components, centralized copy/config, component gallery, icons, offline shell and lazy book caching.
- Today/weekly rhythm, due sessions, automatic four-step first-letter ladder, physical and on-screen keyboards, slips/peek/results, shortcut pass/fail, learned keepsake, FSRS review, configurable goals and seven-day gentle-return ramp.
- Library starter paths and progress, collection detail/practice/add/remove, verse reference/range lookup in BSB/KJV/WEB, private own text, and full catechism/creed browsing.
- IndexedDB signed-out use and queued sync; SQLite-backed UserDO and RegistryDO; idempotent append-only review events, item LWW/tombstones and account merge.
- Real passkey registration/login, signed HttpOnly sessions, hashed one-use rotating recovery codes, optional Google OAuth code flow, account settings/export/deletion and push settings/test notification. Worker cron selects due/unpracticed users at their chosen local time; RFC 8291 encryption and VAPID use WebCrypto.
- Parameterized SQL, same-origin write protection, auth rate limits, CSP and related static headers, no analytics or third-party font requests.
- Reproducible, pinned public-domain content sources and generated packs: 198 Bible books across three translations, 93,302 verse records, 238 document items, and five starter paths. Full WSC (107), Heidelberg (129 across 52 Lord's Days), Apostles' and Nicene creeds. Font licenses and content provenance are committed.

## Verification

| Check | Result |
| --- | --- |
| `npm run check` | PASS — zero errors and warnings |
| `npm test` | PASS — 124 tests in 6 files |
| Pure engine coverage | 100% statements, branches, functions and lines (114 engine tests) |
| Backend cryptography/security | 6 passing unit tests, including independent push decryption and VAPID verification |
| Local reconciliation | 4 passing unit tests |
| `npm run e2e` | PASS — 32 tests, 2.1 minutes, no skipped tests |
| Browser/API matrix | 16 journeys each in iPhone 15 light and dark Chromium emulation |
| `npm run build` | PASS (also run by the E2E web server) |
| `npm run content:verify` | PASS — record counts, lookup/ranges/aliases, invalid references, lazy fetching and pack integrity |
| Offline content regeneration | PASS — byte-identical generated output from pinned committed source inputs |

Browser journeys cover complete verse/catechism ladders, failure/repeat/peek, shortcut pass/fail, review grades, keyboard keys, all starters/document choices, account and theme controls, custom text and all Bible translations, collection add/practice/remove, offline reload/restart, gentle return, real local WebAuthn via a virtual authenticator, recovery rotation, sync/export/delete, origin rejection and auth throttling. Push permission/subscription is mocked in browser tests.

Screenshots: `/home/ubuntu/projects/byheart/test-results/screens/` — **112 PNGs, 56 per appearance**. HTML report: `playwright-report/`; traces and related artifacts: `test-results/`.

## Known gaps and decisions

- Nothing was published or deployed; production routing, bindings, secrets and cron delivery still need the architect's deployment review.
- Real Google OAuth round-trip requires client credentials and was not exercised; the implementation is conditional and its button remains hidden without configuration.
- Browser push subscriptions are mocked. Encryption/VAPID are independently tested, but live provider delivery, real iOS notification behavior and real-device Safari are unverified. The UI explains iOS Home Screen installation.
- Localhost HTTP omits the cookie Secure flag only for development; HTTPS sessions set Secure. Use `localhost`, not an IP literal, for the local passkey RP.
- Bible books become available offline after their first opening; all starter texts and full catechism/creed documents are in the precached shell. Build-time service-worker generation includes every hashed shell asset.
- Reminder dispatch is bounded to 200 accounts per invocation. Review scale/cursoring before a larger public launch.
- The optional reference-typing drill, additional copyrighted translations, and groups from the broader product spec are outside this launch build. No ESV/NIV/NKJV wording is shipped. KJV's UK rights caveat is documented in `content/SOURCES.md`.
- Production dependency audit is clean; the complete dependency tree has three low-severity development-tool advisories.

## Exact local commands

Node 24 is required. From a clean checkout:

```sh
cd /home/ubuntu/projects/byheart
npm ci
npx playwright install chromium
node scripts/local-secrets.mjs
npm run check
npm test
npm run e2e
npm run content:verify
npm run build
npm run serve
```

Open **http://localhost:8793**. Local secrets stay in ignored `.dev.vars`; the helper creates a development-only session key and VAPID keys without printing them. The E2E suite starts its own local Wrangler server when needed. Do not rebuild assets concurrently with a running suite.

To regenerate committed content without network access:

```sh
python3 scripts/build-content.py
node scripts/verify-content.mjs
```

`AGENTS.md`, `README.md`, `cloudflare/BACKEND-API.md` and `content/SOURCES.md` document maintenance, runtime contracts and provenance.
