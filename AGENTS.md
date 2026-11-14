# Incord
An offline-first, open-source Scripture/catechism memory PWA. Svelte 5 + Vite + TypeScript; one Cloudflare Worker, SQLite-backed UserDO per account, RegistryDO, and GroupDO per group. No D1. First-party anonymous daily usage counts only; no third-party trackers. ESV is fetched through a same-origin proxy.

## Product decisions
- Preserve the soft, tactile visual design and reusable component system. One light/dark token file; self-hosted OFL Figtree/Literata.
- Automatic four-step first-letter ladder. Score only hidden words; a wrong letter advances the word and records a slip.
- iOS haptics require a trusted tap on a native transparent switch overlay beside the button (never reparent a Svelte-owned button) (src/haptic-overlay.ts); never replace it with scripted click/hidden label activation. The shared hapticOverlay Svelte action scopes every app button; shared components register explicitly and dynamic screen-local buttons are discovered. Keep default toggle activation, original layout, practice focus and exactly-once dispatch. Defer the button action to the next task and hold overlay scan/refresh/removal until that action plus one animation frame; never move a switch during its native activation. Exclude links and native form controls. Android uses navigator.vibrate(8) once per button tap; physical keys do not vibrate. Recorded CC0 key audio remains ambient and respects Silent. The single sample selection constant is public/audio/keyboard-samples.js; /sound-lab.html compares candidates.
- Practice uses Incord keys only (plus physical keyboard input). Ignore retired typingMode/peekNoteDismissed settings and their field clocks on load/sync. The keyboard has three rows only; the conditional 123/ABC key lives left of Z in row three. The first-letter instruction uses the feedback lane only until the session’s first key; wrong letters reveal the word without a separate Peek control. The unlinked /haptics-lab.html compares native switch variants on hardware.
- Pure engine in src/engine, rules/copy in src/config. FSRS review. IndexedDB is authoritative while offline; sync uses LWW items, append-only idempotent review events.
- Bundled BSB/KJV/WEB and historic public-domain catechisms/creeds. ESV is fetched through the Crossway API under its published conditions; never bundle it or persist its text server-side. Never introduce other copyrighted translations without publisher authorization. See content/SOURCES.md.
- All local functionality works signed out. Google OAuth and email codes conditional on credentials. No passwords.
- Gentle-return backlog is capped, not presented as overdue debt.
- Screens compose reusable components; keep visual styling in app.css/tokens.css.

## Files
src/App.svelte — screen and session composition.
src/components — tactile reusable primitives.
src/store.ts — IndexedDB, API client, reconciliation.
src/content.ts — lazy Bible book lookup, bundled starters/documents.
src/engine — DOM-free tokenization/masking/grading/transitions/scheduling/return.
cloudflare/worker.ts — API, SQL Durable Objects, signed sessions, push encryption and cron.
scripts/build-content.py — fetch/verify/rebuild content; committed generated content means normal builds need no downloads.
public/sw.js — offline shell/book cache and notification receiver.

## Development
Node 24. npm ci; npx playwright install chromium.
npm run check; npm test; npm run build.
npm run serve — local Wrangler at http://localhost:8793 (build hook runs automatically).
For frontend HMR: npm run dev (API/account functionality requires Wrangler).
npm run e2e — starts disposable localhost Worker when needed.
See README.md for local secrets. Never commit .dev.vars or production credentials.

## Security
Parameterized SQL; never render user HTML. Same-origin checks on all writes, signed HttpOnly cookies, auth throttling, single-use keyed-hash email codes. Use Secure cookies on HTTPS; localhost HTTP omits Secure for development only. Push endpoints allowlisted and redirects refused with `redirect: 'manual'` (3xx is failure; Workers reject the `error` redirect mode).
Preserve migration history; additive migrations only. Never log text, recovery codes or secrets.

## Lifecycle contracts
- Practice uses a detached attempt. Shortcut/rehearsal never mutate stored progress on opening. Save completed attempts before the result sheet; result buttons only navigate. Rehearsals are blank, no-stakes and append no review event.
- `dailyPlan` reserves the new/learning allowance (default 3, options 1/2/3/5); completing today's new learning must not free another slot. Reviews do not consume new slots. Estimate from remaining ladder steps and token count.
- Use `addItems`/`findLiveItem`; ids are unique even across tombstones. Re-add revives with strictly newer revision and reset progress. Sort collections canonically, not by sync arrival.
- IndexedDB stores cached account identity. Config fetch is independent; reconnect/focus/visibility retries identity and queue. Never sync unclaimed device items until explicit Add/Keep separate choice. Signout confirms and clears account data from this device after sync.
- Settings use per-field timestamps; ordinary item saves must not advance preference clocks. Assign the `persist()` result back before syncing. Email/Google sign-in adds a device session; only logout-everywhere revokes other devices.
- Copy and plural helpers live in `src/config/copy.ts` with semantic keys (compatibility modules only re-export). Gallery requires DEV or device `localStorage.debug = '1'`.
- `displayTokens` preserves punctuation and original whitespace. VerseText owns current-word scrolling, including reduced motion. Bible superscriptions live in optional headings, not practice text; creed articles and >150-word answers are generated in the content pipeline.
- Canonical item keys derive from the source (Bible coordinates, document number/part, own-text creation time), never from catechism question wording. Persist/migrate the keys; Today reviews sort by due time then that key.
- Long Bible lookups use one exclusive passage format choice above results. Default >150 words to ~4-verse chunks; >500 words confirms the selected item count, even when it is one item.
- Pending signed-in sync queues retry at 5s/15s/60s/5min without needing browser connectivity events. Remote revocation clears device data, preference baselines and account sheets, with a one-time notice.
- Asset-first serving: existing files bypass the application Worker; keep the selective dynamic run_worker_first routes and public/_headers in sync with finish(). Keep assets.not_found_handling=none so static misses stay 404; only extensionless HTML app routes receive shell fallback. HTML carries no-transform to suppress Cloudflare automatic RUM injection; all responses carry one-year HSTS without subdomain/preload directives. Keep enforcing CSP and Latin/Latin-ext WOFF2-only fonts.

## Logging
First-party operational logs only: Cloudflare dashboard → Workers → byheart → Logs, or `npx wrangler tail` from this project. Push attempts record kind, endpoint hostname (not full endpoint), HTTP status, first 200 characters of a sanitized provider reason and elapsed milliseconds. The account's UserDO retains its last ten results for Account → Delivery log. Worker 5xx/unexpected failures include a request id (cf-ray, or local fallback), also returned in error JSON. Client reports go only to same-origin `/api/log`, IP-rate-limited and capped at 2 KB: generic error class, asset-only stack locations, coarse route, build SHA and UA family. No third-party telemetry, user text, verse content, keys, recovery codes, endpoint URLs or account ids are logged. Never send raw exception messages from the client; they may contain private text.

## Incord identity and host migration
- Product name is Incord; canonical origin is https://incord.jesklabs.com. Only the canonical custom domain belongs to the main Worker. The separate cloudflare/legacy-redirect Worker owns the old byheart.jesklabs.com domain; deploy main first to release that route, then the legacy Worker.
- **Keep Worker script name `byheart`, existing UserDO/RegistryDO classes and bindings, migration history and internal browser/storage keys unchanged.** These are persistent identities, not product copy; renaming them can strand accounts/data. New DOs require additive bindings/migrations.
- Wrangler’s build hook always rebuilds before serve/deploy; Vite stamps the short HEAD at build time. Commit before deploying; never upload stale prebuilt assets. Stats CSS is a separate stable Vite entry sharing app tokens/fonts.
- `scripts/deploy.sh` passes production APP_ORIGIN; local dev remains origin-agnostic. Old pages redirect 301 with path/query preserved; old APIs return 410. Serve legacy SW unregister code before redirecting; no WebAuthn metadata remains.
- Crossway attribution verified 2026-11-13: https://api.esv.org/#copyright and https://api.esv.org/docs/passage-text/. Use exact full notice plus download limit from `copy.esvCopyright` / `copy.esvDownloadNotice` in About and a visible linked ESV label with each quotation. Device-only cache, 500-verse and half-book limits, no ESV text in sync/server storage/logs or SW caches. Never alter quoted words.
- Anonymous first-party counts are opt-out, honor GPC/DNT, and contain categorical events only. Daily rotating tokens are deleted after rollup. Weekly totals sum daily counts and are not deduplicated people.
- Live ESV smoke is opt-in (`ESV_LIVE_SMOKE=1 npm run smoke:esv`), one request with no retries. Normal tests mock ESV; do not spend real API requests in CI.


## Licensing and contributions
- Original project code is MIT; preserve LICENSE and NOTICE. Third-party Scripture/content/fonts retain their separate terms. See content/SOURCES.md and public/licenses/.
- Do not commit credentials, private account data or operator-specific machine paths. Use .dev.vars.example for local configuration and README.md for self-hosting.
- Report vulnerabilities through SECURITY.md. Keep ordinary bug reports free of private text and credentials.
