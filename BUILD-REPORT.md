# Incord — build report

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


## Architect fix batch 1 — 2026-11-13

Applied all eleven requests in FIX-1-architect.md: factual copy and result counts, shared count grammar, human-readable source/status labels, simplified welcome-back choices, bottom-flush dynamic-viewport keyboard with a scrolling passage, navigation clearance, initial/person avatar, collection-colored text keepsake with check-draw animation, nonwrapping Discover segments, single-line weekly label above the dots, and grouped Account cards.

Verification: `npm run check` passes with zero errors/warnings; `npm test` passes all 124 tests (engine coverage remains 100%); `npm run e2e` passes all 34 journeys across light/dark mobile Chromium in 2.0 minutes, including the new 375px fit/navigation-clearance journey. The E2E server also rebuilt the production assets successfully. Assertions now cover singular/plural hero copy, source labels, absence of visible raw keys, hidden-word result counts, viewport keyboard bounds, and keepsake text/reference.

Screenshots now default to viewport captures, with seven `-full.png` scrolling companions per theme. Refreshed review selections (Today, step 2, Learned, Discover and Account in both themes) are copied to `/home/ubuntu/.openclaw/workspace/reports/bible-memory-20261113/fix-1-screens/`; all captures remain in `test-results/screens/` and the browser report in `playwright-report/`.

No push or deployment. The separate `/home/ubuntu/projects/byheart-qa` worktree was not touched.

## Independent QA fix batch 2 — 2026-11-13

Addressed all 53 findings (3 P0, 23 P1, 27 P2), following the architect decisions. The complete id-to-commit/test mapping is [QA-FIX-2-MAP.md](QA-FIX-2-MAP.md). No requested finding was deferred or disagreed with.

- Current-word scrolling is independently checked for Heidelberg Q1 and a 120-word own text, in both appearances and reduced/normal motion. Visible mistakes receive amber/shake feedback without changing hidden-only memory scoring.
- Attempts are detached; shortcuts are temporary, completed attempts save before the result sheet, and blank rehearsals never alter history, learned state or schedule. FSRS short-term steps are disabled.
- Daily new/learning allowance defaults to 3 (1/2/3/5), reserves completed slots using the local calendar day, and offers Library Start early. Estimates use word count and remaining ladder steps. Review titles and dates are factual.
- Re-add revives a unique tombstone with a newer revision/reset progress. Canonical ordering and named real collections survive synchronization. Removal is confirmed and undoable for five seconds.
- Ranges default to a single passage, with separate-verse/four-verse-chunk choices and large-batch confirmation. Documents have collapsed numbered answers, Lord's Days and bulk actions. Starters preview before addition. Apostles has 12 articles, Nicene 17 clauses; long catechism answers split at 150 words. Generated documents now total 268 items; 198 Bible packs still contain 93,302 verse records. Psalm superscriptions are optional headings, never typed verse text.
- IndexedDB caches identity. Config failure cannot block identity/reconnect, and online/focus/visibility events retry the queue. All newly acquired identities, including OAuth returns, require explicit ownership consent for existing device records (including removed text/history). Signout clears account data after saving; recovery preserves other device sessions, and Sign out everywhere explicitly revokes them.
- Settings use changed-field clocks and per-field merges. Account names are trimmed and exported consistently. Time zones use a searchable supported-zone select and server validation.
- Semantic copy and plural helpers live in copy.ts; the numeric generated UI map is removed. SVG tabs, stronger contrast, 44px controls, guarded browser history, scroll reset, hidden production gallery and non-inlined self-hosted fonts complete the polish pass.

### Final verification

| Check | Result |
| --- | --- |
| `npm run check` | PASS — zero errors/warnings |
| `npm test` | PASS — 157 tests in 8 files; 123 engine tests, 100% engine coverage across statements/branches/functions/lines |
| `npm run e2e -- --workers=2` | PASS — 84 journeys (42 light, 42 dark), no skips, 2.4 minutes |
| Production build | PASS — built by the E2E web server |
| `npm run content:verify` | PASS — all generated packs, lookups/ranges, headings, articles and integrity |
| Independent integration review | Completed; OAuth ownership, removed-record consent, local-day accounting and consumed-sheet history findings fixed and regression-tested |
| Viewport review set | 74 PNGs, equal light/dark coverage, copied to fix-2-screens |

Viewport review images are in `/home/ubuntu/.openclaw/workspace/reports/bible-memory-20261113/fix-2-screens/`; the complete local Playwright report and traces remain in `playwright-report/` and `test-results/`.

No push or deployment performed. `/home/ubuntu/projects/byheart-qa` was not modified. Existing production-only gaps remain unchanged: live Google credentials/provider push and real iOS/Safari delivery require deployment/device verification.


## Architect fix batch 3 — 2026-11-13

Applied FIX-3-polish.md: collection rows now have independent inline 44px options controls, a single title in a 120px motif header, transient addition toasts and a full-width final practice button. Document questions keep their answer disclosures and bulk actions, with trailing round 44px add/check controls. Gentle return now applies day-zero capping before the welcome choice as well as afterward. Review workload remains one blank pass at 1.2 seconds per word, with a one-minute minimum, explicitly regression-tested.

Added `scripts/prod-smoke.mjs`, a real Chromium/iPhone 15 UI/API journey with a four-step Gospel John 3:16 ladder, CDP virtual passkey, explicit device ownership and sync, second-context recovery, learned/history verification, push configuration, service-worker activation, enforcing CSP/console checks and guaranteed account/profile cleanup with pass/fail reporting. README documents local and production targets. Local Wrangler serve/E2E commands now disable route-based origin inference: the production custom-domain route otherwise rewrites the local WebAuthn RP ID to byheart.jesklabs.com.

Verification: static checks pass with zero errors/warnings; 158 tests pass in eight files, with 100% engine coverage; content verification passes (198 packs, 93,302 verses, 268 document items and five starters). Local smoke against the E2E suite's real `wrangler dev` at `http://localhost:8793` passes all 14 checks in 8.2 seconds, including cleanup and zero console/CSP errors. All 86 mobile E2E journeys pass (43 per appearance, no skips, 3.4 minutes), including both welcome choices and inline touch-target/header/primary-button geometry. Production smoke was not run against the live site.

Viewport review captures are refreshed in `/home/ubuntu/.openclaw/workspace/reports/bible-memory-20261113/fix-3-screens/`. No push or deployment performed; the QA worktree was not touched.

## Production QA2 fix batch 4 — 2026-11-13

Applied every N1–N21 finding and the P1-10 partial in FIX-4-qa2.md. The full finding-to-implementation/test mapping is [QA-FIX-4-MAP.md](QA-FIX-4-MAP.md).

- Source-derived canonical keys now migrate/persist for all items. WSC/Heidelberg follow question/part order, Bible items follow book/chapter/verse, own texts follow creation time, and due reviews sort by due time then source key.
- Long lookups default to ~4-verse chunks above 150 words. The exclusive three-way format choice and Add action appear above results; every >500-word lookup confirms its selected item count, even a single passage.
- Signed-in devices can attach a passkey, with a one-time recovery invitation and friendly cancellation/unsupported/already-registered copy. Recovery and ownership sheets are sequential. Global signout is confirmed; remote revocation gives one notice and resets device data, preference baselines and sheets. An independent Opus integration review found four account/history edge cases; all were fixed, including rejecting stale/wrong-account enrollment and in-flight registration challenges after revocation.
- Off-band words scroll instantly; pending queues retry at 5s/15s/60s/5min without connectivity events. Practiced-week contrast, Discover target heights, creed article labels, added checks, failed-review copy, tappable backdrops and collapsible short-screen practice titles are corrected. Fix-3's inline collection controls were verified.
- Worker-first static routing preserves genuine static/dotfile 404s and safe SPA routes. HSTS is one year without includeSubDomains/preload. Only 12 Latin/Latin-ext WOFF2 faces are emitted/precached. HTML preserves cache policy while adding no-transform; enforcing CSP remains unchanged.

### Final verification

| Check | Result |
| --- | --- |
| `npm run check` | PASS — zero errors/warnings |
| `npm test` | PASS — 182 tests in 10 files; 123 engine tests, 100% engine statement/branch/function/line coverage |
| `npm run e2e -- --workers=2` | PASS — 100 journeys, 50 per appearance, no skips, 3.3 minutes |
| Production build | PASS — rebuilt by the complete E2E suite |
| `npm run content:verify` | PASS — 198 packs, 93,302 verses, 268 document items and five starters |
| `SMOKE_URL=http://localhost:8793 node scripts/prod-smoke.mjs` | PASS — 14/14 checks in 9.5s; real local passkey/recovery/sync/ladder, enforcing CSP, no console/CSP errors and successful account cleanup |
| Viewport review captures | 26 PNGs, equal light/dark coverage, in `fix-4-screens/` |

The production smoke helper follows the new recovery-before-merge sequence and isolates localhost QA rate-limit callers. Browser tests block service workers specifically when emulating an offline/404 network failure; real service-worker caching/offline navigation has separate assertions.

**N5 finding:** Cloudflare's [official Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/#my-website-is-proxied-through-cloudflare-but-web-analytics-automatic-setup-is-not-working) explicitly documents `Cache-Control: public, no-transform` as preventing automatic beacon injection. Adding the no-transform directive therefore suppresses automatic RUM/beacon injection without allowing the beacon through CSP. Local headers and console checks pass; live edge suppression remains unverified because no deployment or production smoke was performed. No zone/NEL settings were changed.

Review captures: `/home/ubuntu/.openclaw/workspace/reports/bible-memory-20261113/fix-4-screens/`. Complete HTML report/traces remain in `playwright-report/` and `test-results/`. No push or deployment performed; the QA worktree was not touched. Existing live-provider/iOS/Safari verification gaps remain unchanged.
