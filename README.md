# Incord
A little practice. A lasting word.

An offline-first mobile PWA for Scripture, catechisms, and creeds. Light/dark tactile UI, automatic first-letter learning ladder, FSRS review, local practice without an account, optional email-code/Google account sync and gentle Web Push.

## Run locally
Node 24 required.

```sh
npm ci
npx playwright install chromium webkit
node scripts/local-secrets.mjs
npm run build
npm run serve
```

Open http://localhost:8793. Nothing is deployed. Local SQLite state stays in .wrangler; browser practice stays in IndexedDB. Production VAPID and Google credentials are optional and must be configured separately.

## Verify

```sh
npm run check
npm test
npm run e2e
npm run content:verify
```

Screenshots are written to test-results/screens/. Tests use disposable localhost accounts and CDP virtual authenticators, never production data. Push subscription browser permissions are mocked; the backend tests exercise Web Push encryption.

## Content
Normal builds use committed generated public-domain JSON. Bible books download into the offline cache only when first opened; starter paths and full documents are in the offline shell. See content/SOURCES.md and scripts/build-content.py --help for the reproducible source pipeline.

## Production (after review)
Build assets, configure SESSION_SECRET (32+ random bytes), APP_ORIGIN, optional VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT, optional GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET. Email sign-in requires RESEND_API_KEY. EMAIL_FROM optionally overrides the default Incord <signin@incord.jesklabs.com>; verify that sender domain in Resend. Every code email sets reply_to to incord-support@googlegroups.com. Google requests email scope to link verified Gmail/Workspace addresses with email-code identities; other Google accounts can explicitly add email sign-in. No new passkeys are offered; legacy passkeys/recovery remain available for migration. Configure Google's callback to /api/auth/google/callback. VAPID private key is the base64url P-256 scalar. Use the same stable session secret and VAPID key across releases. Wrangler config includes the 15-minute reminder cron and SQLite Durable Object migrations. Use `scripts/deploy.sh` only after review; it supplies `APP_ORIGIN=https://incord.jesklabs.com`. Wrangler’s configured build hook rebuilds assets immediately before local serve or deployment, including direct `wrangler deploy` calls. Vite stamps About/telemetry with `git rev-parse --short HEAD` at build time; commit release changes before deploying so pre-commit assets cannot carry an older SHA. This change has not been deployed or pushed.


## Live-stack smoke

With a local build and `npm run serve` running, use:

```sh
SMOKE_URL=http://localhost:8793 node scripts/prod-smoke.mjs
```

Without `SMOKE_URL`, the script targets https://incord.jesklabs.com. It uses Chromium at the iPhone 15 viewport, learns John 3:16 through all four steps, signs in as `jung.ai.assistant@gmail.com` with real emailed codes on two isolated devices, confirms explicit ownership/sync, checks CSP/console, push configuration and service workers, then deletes the smoke account even if a check fails. It never saves codes or browser profiles. Email delivery and push keys must be configured; push delivery itself is not exercised.

The default code reader runs `gog --account jung.ai.assistant@gmail.com --no-input gmail search 'from:signin@incord.jesklabs.com newer_than:10m' --max 1`. Only `GOG_HOME`, `GOG_KEYRING_BACKEND`, and `GOG_KEYRING_PASSWORD` are loaded from `/home/ubuntu/.openclaw/.env` into that subprocess, never printed. Override with `SMOKE_CODE_CMD` (a trusted shell command printing the latest subject or bare six-digit code), including for a local test sink. Previously observed codes are ignored. Each successful run requests two codes; the per-email limit is three per 15 minutes. A 429 waits 15 minutes before one retry, and mailbox polling never resends a code.

Local Wrangler commands disable route-based origin inference so WebAuthn sees `localhost`, not the production custom domain.

## Incord host migration

The canonical origin is **https://incord.jesklabs.com**. Keep both custom-domain routes in `wrangler.jsonc`. The Worker script remains **byheart**, with the existing UserDO/RegistryDO bindings, migration history and internal storage keys intact: renaming them would strand production accounts. The repository directory need not change.

The old origin redirects pages to the same path/query on Incord (301). Old `/api/*` calls return a 410 JSON update message; old `/sw.js` unregisters and moves open windows to Incord. `/.well-known/webauthn` on the old origin advertises Incord as a related origin. Existing passkeys remain bound to their old RP ID: supporting browsers can use the related-origin flow, otherwise use a recovery code, then add email sign-in from Account. Browser IndexedDB and push subscriptions cannot transfer across origins. Re-enable reminders on the new origin; account sync recovers saved public-domain items and practice history. Unsynced device-only material remains on the old origin and is not automatically migrated.

### Reviewed production deployment

Keep the existing `SESSION_SECRET` and VAPID credentials. Set a separate strong random `STATS_TOKEN` using `npx wrangler secret put STATS_TOKEN`; the existing Worker `ESV_API_KEY` remains in place. Configure Google OAuth to allow `https://incord.jesklabs.com/api/auth/google/callback` if enabled. Confirm both Cloudflare custom domains can attach to the existing `byheart` Worker, then deploy:

```sh
scripts/deploy.sh
node scripts/prod-smoke.mjs
```

The production smoke checks the old-origin redirect (including path/query), old API 410 response, related-origin metadata and legacy service worker. For a local `SMOKE_URL`, it exercises the legacy host using a loopback Host header, without contacting production. `SMOKE_LEGACY_URL` can override the legacy target. Deploying and running the live smoke are architect-owned steps; the smoke creates and deletes a disposable production account.

## ESV attribution and device cache

ESV is not part of the bundled public-domain corpus. The same-origin `/api/esv` proxy uses `ESV_API_KEY` on the server, without a server text cache. ESV text stays on the device only, is excluded from sync/export to the server, and is loaded again on another device. The library is limited to 500 ESV verses; Crossway additionally limits local storage to one half of any book, whichever is less. ESV text must not be altered; practice masking affects display only. Every screen displaying ESV quotations links its ESV attribution to https://www.esv.org.

Checked 2026-11-13 against the [API overview](https://api.esv.org/docs/), [API conditions and copyright](https://api.esv.org/#copyright) and [passage-text parameters](https://api.esv.org/docs/passage-text/). The short form is “ESV” with each quotation; `include-short-copyright` otherwise adds `(ESV)` by default. The app disables that inline suffix and provides its own visible ESV link. Full notice (also in About):

> Scripture quotations marked “ESV” are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved. The ESV text may not be quoted in any publication made available to the public by a Creative Commons license. The ESV may not be translated into any other language.
>
> Users may not copy or download more than 500 verses of the ESV Bible or more than one half of any book of the ESV Bible.

The real upstream smoke is **opt-in**, separate from unit/E2E fixtures and normal production smoke:

```sh
ESV_LIVE_SMOKE=1 WORKER_URL=http://localhost:8793 npm run smoke:esv
# After deployment, set WORKER_URL=https://incord.jesklabs.com explicitly.
```

It calls `/api/esv` exactly once, makes no retries and prints no verse text or credentials. The target Worker must have a valid ESV key. No live ESV requests run during normal builds or tests.

## Privacy and private statistics

Incord counts anonymous totals (like how many people practiced today) to improve the app. No ads, no third-party trackers. Account → Privacy can turn counts off; Global Privacy Control and Do Not Track also turn them off. Categorical events carry no account ID, IP, user agent, verse text, own text or references. Random device tokens rotate each local day. StatsDO deletes daily token sets after rolling them into counts. Weekly activity is the sum of daily active-device counts, **not deduplicated weekly people**. `/stats` uses `STATS_TOKEN` and a signed HttpOnly cookie; never put that token in a URL. Operational failure logs remain separate from anonymous usage counts.

## Email-code local testing

Use `--var EMAIL_TEST_SINK:1` with local Wrangler to intercept codes without contacting an email provider; GET `/api/test/last-code?email=person%40example.com` returns the last unexpired code on localhost/127.0.0.1 only. The sink and test delivery cannot activate on public hosts, even with the flag. Do not set this flag in production. Email mappings use a one-way keyed hash; keep SESSION_SECRET stable.
