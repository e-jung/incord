# Incord
An offline-first, open-source Scripture/catechism memory PWA. Svelte 5 + Vite + TypeScript; one Cloudflare Worker, SQLite-backed UserDO per account, RegistryDO, and GroupDO per group. No D1. First-party anonymous daily usage counts only; no third-party trackers. ESV is fetched through a same-origin proxy.

## Product decisions
- Preserve the soft, tactile visual design and reusable component system. One light/dark token file; self-hosted OFL Figtree/Literata.
- Automatic four-step first-letter ladder. Score only hidden words; a wrong letter advances the word and records a slip.
- iOS haptics require a trusted tap on a native transparent switch overlay beside the button (never reparent a Svelte-owned button) (src/haptic-overlay.ts); never replace it with scripted click/hidden label activation. The shared hapticOverlay Svelte action scopes every app button; shared components register explicitly and dynamic screen-local buttons are discovered. Keep default toggle activation, original layout, practice focus and exactly-once dispatch. Defer the button action to the next task and hold overlay scan/refresh/removal until that action plus one animation frame; never move a switch during its native activation. Exclude links and native form controls. Overlay and keyboard-gap activation requires a genuine short stationary tap: reject >10px movement, >700ms holds, cancellation, or ancestor/window scrolling; track only that target’s own changed touch and allow native horizontal/vertical panning. Android uses navigator.vibrate(8) once per button tap; physical keys do not vibrate. Recorded CC0 key audio remains ambient and respects Silent. The single sample selection constant is public/audio/keyboard-samples.js; /sound-lab.html compares candidates.
- Practice uses Incord keys only (plus physical keyboard input). Ignore retired typingMode/peekNoteDismissed settings and their field clocks on load/sync. The keyboard has three rows only; the conditional 123/ABC key lives left of Z in row three. The first-letter instruction uses the feedback lane only until the session’s first key; wrong letters reveal the word without a separate Peek control. The unlinked /haptics-lab.html compares native switch variants on hardware.
- Pure engine in src/engine, rules/copy in src/config. FSRS review. IndexedDB is authoritative while offline; sync uses LWW items, append-only idempotent review events.
- Bundled BSB/KJV/WEB and historic public-domain catechisms/creeds. ESV is fetched through the Crossway API under its published conditions; never bundle it or persist its text server-side. Never introduce other copyrighted translations without publisher authorization. See content/SOURCES.md.
- All local functionality works signed out. Email-free sign-in codes work with SESSION_SECRET alone; Email and SSO use ACCOUNTS_SVC; legacy Google stays default until ACCOUNTS_GOOGLE=1 after provider setup and a verified production sign-in. No passwords.
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
On shared/CPU-constrained hosts, run the three Playwright projects sequentially with `--project=iPhone15-light`, `--project=iPhone15-dark`, then `--project=WebKit-iPhone15`. Inspect request/action traces before changing production tap or feedback timing to address a test timeout. Groups `aria-busy` covers the complete list/detail refresh; wait for idle between independently tested resume triggers.
See README.md for local secrets. Never commit .dev.vars or production credentials.

## Security
Parameterized SQL; never render user HTML. Same-origin checks on all writes, signed HttpOnly cookies, auth throttling, single-use email codes via the Jesklabs Accounts service binding. Persistent Incord identity records store only email fingerprints and pairwise jl subjects, not readable sign-in email. The server-side SSO confirmation challenge temporarily holds the returned address, expires after five minutes, and is consumed on confirmation/cancellation; never persist SSO tickets. Every cookie is host-only (never Domain=). Use Secure cookies on HTTPS; localhost HTTP omits Secure for development only. Push endpoints allowlisted and redirects refused with `redirect: 'manual'` (3xx is failure; Workers reject the `error` redirect mode).
Preserve migration history; additive migrations only. Never log text, recovery codes or secrets.

## Lifecycle contracts
- Practice uses a detached attempt. Shortcut/rehearsal never mutate stored progress on opening. Save completed attempts before the result sheet; result buttons only navigate. Rehearsals are blank, no-stakes and append no review event.
- `dailyPlan` reserves the new/learning allowance (default 3, options 1/2/3/5); completing today's new learning must not free another slot. Reviews do not consume new slots. Estimate from remaining ladder steps and token count.
- Use `addItems`/`findLiveItem`; ids are unique even across tombstones. Re-add revives with strictly newer revision and reset progress. Sort collections canonically, not by sync arrival.
- IndexedDB stores cached account identity. Config fetch is independent; reconnect/focus/visibility retries identity and queue. Never sync unclaimed device items until explicit Add/Keep separate choice. Signout confirms and clears account data from this device after sync.
- Settings use per-field timestamps; ordinary item saves must not advance preference clocks. Assign the `persist()` result back before syncing. Email/Google sign-in adds a device session; only logout-everywhere revokes other devices.
- Sign-in codes use three cryptographically chosen words from the shared 2048-word kid-safe list plus four unbiased digits (46.28 bits). Store only a domain-separated HMAC in RegistryDO; never log or sync plaintext. A device-only code cache is gated by account ID and non-secret revision, cleared on signout/revocation/removal, and revealed only after a tap. Required save acknowledgment survives reload and gates sync, local-item ownership merge, Groups invite and OAuth continuation. Regenerating an existing account never repeats the new-account merge. Code and jl mappings are non-orphans; removal requires another sign-in method.
- Groups has its own fourth bottom tab; Today only shows a compact attention link for manager approvals, received prayers, or a started goal ≥80% learned with 1–2 items left. Groups refreshes on tab entry, visible focus/resume, pull from the page top, and mutations. Keep pending badges in the Groups nav icon and join deep links on Groups. Attention exposes only authorized counts, with received-prayer attention using the recipient’s local day while preserving the existing UTC daily dedup.
- Action feedback stays beside its originating control: errors use alert, successes use status and expire after ~3 seconds; global notices are reserved for app-level sync/offline/sign-in state. Discover defaults to Topics, retains its chip during navigation, and keeps reference/own-text forms under Add your own. Horizontal covers/chips bleed to page edges with the same 24px resting/scroll gutter and proximity snapping; never let their native overlays turn a swipe into an action.
- The installed PWA limits page pinch zoom via viewport/touch-action/non-passive WebKit gesture handlers. Keep form fields at least 16px and preserve the Small–Extra large Text size alternative.
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

## Jesklabs Accounts
Service contract v1 lives in cloudflare/accounts.ts. Use server-side RPC; accounts.jesklabs.com is top-level browser navigation only. Keep PKCE/state and return paths in expiring server challenges bound to __Host-jl_auth. SSO must show an in-app confirm before issuing a session. Leave existing sessions and app-local codes unchanged. Old Google is the default until the explicit ACCOUNTS_GOOGLE switch; import failures must not block legacy sign-in. Deletion must unlink Accounts successfully first. Never edit the Accounts service repo as part of an app cutover. Fake Accounts bindings belong in test-only configurations, never production.
