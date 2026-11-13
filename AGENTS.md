# By Heart
A private, offline-first Scripture/catechism memory PWA. Svelte 5 + Vite + TypeScript; one Cloudflare Worker, SQLite-backed UserDO per account and RegistryDO. No D1. No analytics or third-party requests.

## Product decisions
- Match design C in /home/ubuntu/.openclaw/workspace/reports/bible-memory-20261113/designs/c-soft-tactile.html. One light/dark token file; self-hosted OFL Figtree/Literata.
- Automatic four-step first-letter ladder. Score only hidden words; wrong letter or peek advances the word and records a slip.
- Pure engine in src/engine, rules/copy in src/config. FSRS review. IndexedDB is authoritative while offline; sync uses LWW items, append-only idempotent review events.
- Bundled BSB/KJV/WEB and historic public-domain catechisms/creeds. Never introduce copyrighted translations without publisher authorization. See content/SOURCES.md.
- All local functionality works signed out. Passkeys, recovery, Google OAuth conditional on credentials. No passwords.
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
npm run serve — local Wrangler at http://localhost:8793 (build first).
For frontend HMR: npm run dev (API/account functionality requires Wrangler).
npm run e2e — starts disposable localhost Worker when needed.
See README.md for local secrets. Never commit .dev.vars or production credentials.

## Security
Parameterized SQL; never render user HTML. Same-origin checks on all writes, signed HttpOnly cookies, auth throttling, WebAuthn verification, one-use hashed recovery codes. Use Secure cookies on HTTPS; localhost HTTP omits Secure for development only. Push endpoints allowlisted and redirects refused.
Preserve migration history; additive migrations only. Never log text, recovery codes or secrets.
No deployment or GitHub push is authorized in the initial build. Architect reviews first. Do not add a remote or publish.

## QA-fixed lifecycle contracts (2026-11-13)
- Practice uses a detached attempt. Shortcut/rehearsal never mutate stored progress on opening. Save completed attempts before the result sheet; result buttons only navigate. Rehearsals are blank, no-stakes and append no review event.
- `dailyPlan` reserves the new/learning allowance (default 3, options 1/2/3/5); completing today's new learning must not free another slot. Reviews do not consume new slots. Estimate from remaining ladder steps and token count.
- Use `addItems`/`findLiveItem`; ids are unique even across tombstones. Re-add revives with strictly newer revision and reset progress. Sort collections canonically, not by sync arrival.
- IndexedDB stores cached account identity. Config fetch is independent; reconnect/focus/visibility retries identity and queue. Never sync unclaimed device items until explicit Add/Keep separate choice. Signout confirms and clears account data from this device after sync.
- Settings use per-field timestamps; ordinary item saves must not advance preference clocks. Assign the `persist()` result back before syncing. Recovery adds a device session; only logout-everywhere revokes other devices.
- Copy and plural helpers live in `src/config/copy.ts` with semantic keys (compatibility modules only re-export). Gallery requires DEV or device `localStorage.debug = '1'`.
- `displayTokens` preserves punctuation and original whitespace. VerseText owns current-word scrolling, including reduced motion. Bible superscriptions live in optional headings, not practice text; creed articles and >150-word answers are generated in the content pipeline.
