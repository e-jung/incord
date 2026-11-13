# FIX-6 device feedback verification

## Implementation

- `cloudflare/worker.ts`: Workers-compatible manual redirects (3xx fails without following); 30-minute origin-scoped VAPID JWT; per-attempt JSON operational push logs; bounded/sanitized provider response; last ten per-account results; authenticated hashed subscription health; device-scoped unsubscribe; expired-subscription cleanup; test/daily text and tags. JSON errors include request ids; 5xx/unexpected errors produce structured logs. `/api/log` accepts privacy-filtered client errors only, with same-origin enforcement, per-IP rate limiting, and a streaming 2KB limit.
- `src/notifications.ts`, Account: actual device permission/subscription state instead of a synced preference pretending to describe this device. Reconciles subscriptions on Account entry, identity restoration, focus and SW replacement. Test delivery gives provider-specific results; Delivery log exposes the ten retained results.
- `public/sw.js`: test/daily notification tags and payload body, test renotify, focus/open app on click, same-origin authenticated subscription rotation.
- `src/telemetry.ts`, `src/main.ts`, Vite: generic client error classes and asset-only stack locations, never raw exception messages; coarse path, build SHA, UA family only. SHA shown under Account → About.
- Settings: Small/Default/Large/Extra large, per-field persistence/sync, Apple system-body root font for Dynamic Type, scalable practice/keepsake/list text.
- Practice: fixed viewport independent of document scrolling, top safe-area padding, scroll reset and programmatic focus without scrolling after render/entry/step/result dismissal. VerseText already scrolls only its internal viewport; preserved. Title collapse still starts only after the first typed word. Custom keyboard retained, explicit aria-labels on every key, hardware input scoped to the focused practice region.

## Evidence and limitations

The architect confirmed the push transport root cause in production logs: Workers rejected fetch's `redirect: 'error'` option before contacting Apple. This batch uses `manual`, audits all Worker fetches (no other invalid redirect options), guards against reintroducing that mode, and tests 301/302/307/308 as failed deliveries without following or deleting a still-valid subscription. The VAPID lifetime remains 30 minutes. The architect independently hot-fixed production; this batch itself is not deployed.

`tests/device.spec.ts` uses Playwright's actual iPhone 15 descriptor with WebKit, standalone-like navigator state, a scrolled WSC collection and Q1 at steps 1 and 2. It asserts title bounds against the measured safe area, fixed practice positioning, safe-area padding, and zero outer scroll. It also verifies Extra large at 375×667, persisted size, key labels/focus, and on/missing/denied notification states. These notification fixtures test UI states, not live Apple transport. Hardware-key input, focused-region routing and accessible key names are exercised; a physical iPhone VoiceOver session was not available.

A separate pre-fix production snapshot was exercised in WebKit after scrolling the WSC collection 400px: the original title was at y=103…147, outer scroll had reset to 0, collapse was false, main position was relative and top padding was 16px. The exact clipping did **not** reproduce in this emulator.

The original CSS left practice in document flow (`main` relative; `.practice` height 100dvh) and had only 16px top padding with no safe-area inset. The old `pushView()` also reset window scroll synchronously before Svelte had mounted the practice DOM, leaving a potential first-entry scroll/focus-restoration race. The new fixed layout and post-`tick()` reset/focus remove these vulnerabilities. Desktop WebKit does not reproduce an installed iPhone's physical status-bar/safe-area chrome, so it cannot conclusively identify which device-only timing path caused Eric's original clipping. Do not present the desktop regression as proof of an exact on-device reproduction or a confirmed production Apple delivery.

Screenshot evidence is committed in `fix-6-screens/`, including original/fixed WebKit step 1, notification state/disclosure results, all four text choices and Extra large practice. The generated Playwright report also attaches step-by-step geometry JSON.

Linux Playwright WebKit's offline `page.reload()` aborts with an internal browser error on both the unmodified pre-fix production snapshot and the new build. That one offline-reload journey remains covered in both Chromium themes and is excluded from the WebKit subset, alongside CDP-only passkey/push journeys. All WebKit practice ladders remain included. This is a reproduced harness limitation, not presented as evidence of an iPhone offline failure.

## Checks

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 208 tests, 13 files, 100% engine coverage.
- `npm run content:verify`: 198 Bible packs / 93,302 verse records, 268 document items, five starters.
- Local `SMOKE_URL=http://localhost:8793 node scripts/prod-smoke.mjs`: 14/14 real local production checks, including four ladder rounds, passkeys, ownership consent, recovery across two isolated devices, configured push/SWs and account cleanup.
- `npm run e2e`: 130 passed cases (116 Chromium light/dark; 14 WebKit iPhone 15 practice/UI cases). The WebKit offline-reload exclusion is explained above.

## Read the operational logs

Cloudflare dashboard → Workers → byheart → Logs, or `npx wrangler tail`. Filter `evt` by `push`, `server_error`, or `client_error`. Quote an API error's request id to correlate it. Account → Reminders → Delivery log shows the last ten account push results without exposing subscription URLs or keys. See AGENTS.md → Logging for the privacy contract. No production push or deployment was performed.
