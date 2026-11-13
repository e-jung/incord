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

Screenshots are written to test-results/screens/. Tests use disposable localhost email-code accounts, never production data. Push subscription browser permissions are mocked; the backend tests exercise Web Push encryption.

## Content
Normal builds use committed generated public-domain JSON. Bible books download into the offline cache only when first opened; starter paths and full documents are in the offline shell. See content/SOURCES.md and scripts/build-content.py --help for the reproducible source pipeline.

Discover includes the Westminster Shorter and Larger (historic American OPC/PCA wording), Heidelberg, Baptist/Keach (1695 witness), Spurgeon (1855), and Engles Young Children (1840) catechisms, plus historic creeds. Original question counts, edition notes, sources and five-Q&A spot checks are recorded in [content/SOURCES.md](content/SOURCES.md).

## Production (after review)
Build assets, configure SESSION_SECRET (32+ random bytes), APP_ORIGIN, optional VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT, optional GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET. Email sign-in requires RESEND_API_KEY. EMAIL_FROM optionally overrides the default Incord <signin@incord.jesklabs.com>; verify that sender domain in Resend. Every code email sets reply_to to incord-support@googlegroups.com. Google requests email scope to link verified Gmail/Workspace addresses with email-code identities; other Google accounts can explicitly add email sign-in. Sign-in uses Google or email codes only; passkeys and recovery codes are not supported. Configure Google's callback to /api/auth/google/callback. VAPID private key is the base64url P-256 scalar. Use the same stable session secret and VAPID key across releases. Wrangler config includes the 15-minute reminder cron and SQLite Durable Object migrations. Use `scripts/deploy.sh` only after review; it supplies `APP_ORIGIN=https://incord.jesklabs.com`. Wrangler’s configured build hook rebuilds assets immediately before local serve or deployment, including direct `wrangler deploy` calls. Vite stamps About/telemetry with `git rev-parse --short HEAD` at build time; commit release changes before deploying so pre-commit assets cannot carry an older SHA. Deploy only after review.


## MCP connections

User setup: [Connect an app](https://incord.jesklabs.com/connect.html). The endpoint is `https://incord.jesklabs.com/mcp`, using Streamable HTTP with OAuth. Claude custom connectors and Claude Code can connect; other clients, including ChatGPT, need compatible remote MCP/OAuth support and availability varies by plan and workspace policy. Read/write authorization permits reading and adding only, never editing or deleting existing items. Revoke access in Settings → Connected apps. ESV text remains device-only and is not exposed by MCP. ESV references always stay one passage, matching the app; verse-by-verse splitting applies to BSB/KJV/WEB. Calls accept at most 50 inputs, 500 verses per reference and 1,000 expanded items in total, with independent per-input results.

MCP runs in the **existing `byheart` Worker**, alongside the app and account APIs. The OAuth provider uses a KV-compatible storage adapter backed by a SQLite Durable Object: `OAUTH_STORAGE` is the binding and `OAuthStorageDO` is the exported class. The binding and additive `v3-oauth` migration are already declared in `wrangler.jsonc`; preserve all existing bindings and migration tags. The adapter satisfies the provider's KV storage interface without a KV namespace. Provider tokens are hashed and authorization properties encrypted (grant account IDs, app names, scopes and dates are storage-visible); do not store ESV text in OAuth storage, account storage or logs. Server-side MCP counters are aggregate only, without content or passage references. Dynamic client registration is supported; URL-based client metadata (CIMD) is disabled so external metadata fetches cannot block the shared OAuth store.

Setup uses the existing stable `SESSION_SECRET` and canonical `APP_ORIGIN`; no additional MCP secret, KV namespace, separate Worker or manually created remote resource is needed. Keep the existing optional Google/email sign-in configuration. Wrangler creates the SQLite Durable Object through its additive migration during an authorized deployment. For local testing, use the existing local secrets and `npm run serve`, then connect a compatible client to `http://localhost:8793/mcp` if that client permits localhost OAuth. Configure the public HTTPS URL in hosted clients; some cannot reach local servers. The binding and migration must be verified before deployment.

## Live-stack smoke

With a local build and `npm run serve` running, use:

```sh
SMOKE_URL=http://localhost:8793 node scripts/prod-smoke.mjs
```

Without `SMOKE_URL`, the script targets https://incord.jesklabs.com. It uses Chromium at the iPhone 15 viewport, learns John 3:16 through all four steps, signs in as `jung.ai.assistant@gmail.com` with real emailed codes on two isolated devices, confirms explicit ownership/sync, checks CSP/console, push configuration and service workers, then deletes the smoke account even if a check fails. It never saves codes or browser profiles. Email delivery and push keys must be configured; push delivery itself is not exercised.

The default code reader runs `gog --account jung.ai.assistant@gmail.com --no-input gmail search 'from:signin@incord.jesklabs.com newer_than:10m' --max 1`. Only `GOG_HOME`, `GOG_KEYRING_BACKEND`, and `GOG_KEYRING_PASSWORD` are loaded from `/home/ubuntu/.openclaw/.env` into that subprocess, never printed. Override with `SMOKE_CODE_CMD` (a trusted shell command printing the latest subject or bare six-digit code), including for a local test sink. Previously observed codes are ignored. Each successful run requests two codes; the per-email limit is three per 15 minutes. A 429 waits 15 minutes before one retry, and mailbox polling never resends a code.

Local Wrangler commands disable route-based origin inference so API requests use `localhost`, not the production custom domain.

## Incord host migration

The canonical origin is **https://incord.jesklabs.com**. Keep both custom-domain routes in `wrangler.jsonc`. The Worker script remains **byheart**, with the existing UserDO/RegistryDO bindings, migration history and internal storage keys intact: renaming them would strand production accounts. The repository directory need not change.

The old origin redirects pages to the same path/query on Incord (301). Old `/api/*` calls return a 410 JSON update message; old `/sw.js` unregisters and moves open windows to Incord. Browser IndexedDB and push subscriptions cannot transfer across origins. Re-enable reminders on the new origin; account sync recovers saved public-domain items and practice history. Unsynced device-only material remains on the old origin and is not automatically migrated.

### Reviewed production deployment

Keep the existing `SESSION_SECRET` and VAPID credentials. Set a separate strong random `STATS_TOKEN` using `npx wrangler secret put STATS_TOKEN`; the existing Worker `ESV_API_KEY` remains in place. Configure Google OAuth to allow `https://incord.jesklabs.com/api/auth/google/callback` if enabled. Confirm both Cloudflare custom domains can attach to the existing `byheart` Worker, then deploy:

```sh
scripts/deploy.sh
node scripts/prod-smoke.mjs
```

The production smoke checks the old-origin redirect (including path/query), old API 410 response, legacy service worker. For a local `SMOKE_URL`, it exercises the legacy host using a loopback Host header, without contacting production. `SMOKE_LEGACY_URL` can override the legacy target. Deploying and running the live smoke are architect-owned steps; the smoke creates and deletes a disposable production account.

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

## Practice feedback and whole passages

Settings offers Key sounds and Haptics, both off by default and synced with per-field preference clocks. Sounds are generated locally with a short WebAudio tick (lower tone for a slip). Android uses `vibrate(8)`; iOS 18+ uses a temporary checkbox switch in a hidden label in the document head, with focus restoration. Settings includes Test sound / Test haptic controls and iPhone ring/silent-switch and System Haptics guidance. This iOS technique is best-effort and requires real-device verification; headless tests verify the fallback and focus behavior, not physical vibration. No audio assets or permissions are requested.

Discover → Passages contains 17 curated multi-verse selections, each saved as one memory item, with verse counts and BSB/KJV/WEB/ESV selection. Settings → Default translation (initially BSB) and the single compact picker at the top of Discover share one synced preference for both reference lookups and curated passages. ESV selections are reference-only until preview/practice fetches the quotation on the device; additions retain the existing ESV library limits. Existing per-verse starters are unchanged. 1 Corinthians 13:4–8 includes the full eighth verse and is labeled accordingly.

MCP uses Agents 0.33.0 / MCP SDK 2.4.0 and Workers OAuth Provider 1.2.4, checked against the current [Cloudflare remote MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/), [transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/), [authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/) and [provider README](https://github.com/cloudflare/workers-oauth-provider). `OAuthAuthorizationServer` and `OAuthResourceServer` run together in this Worker; complete provider operations are serialized in OAuthStorageDO, including one-time code consumption and revocation. The SQLite adapter implements the KV subset used by this pinned provider. Re-run the official-SDK integration tests when upgrading it. Before final browser verification, stop any existing local Wrangler process: Playwright reuses a running server, and lazily imported Worker modules may still be serving an older bundle. Start from a fresh Worker and unset HTTP(S)/ALL proxy variables for local tests.


## Feedback

Settings → Send feedback works signed in or out; the optional reply address starts blank and is never copied from sign-in. Device details (version, coarse platform/browser family, viewport and signed-in yes/no) are opt-in per submission via the initially checked box; library data is never attached. A connected MCP app can use `send_feedback(kind, message, contact?)` with any valid token, including read-only access. It sends the explicit feedback and registered client name, never library/device metadata.

`POST /api/feedback` and the MCP tool share validation (Idea/Problem/Other, 10–4,000 trimmed characters, optional contact email), persisted limits of 5/IP/hour and 10/account/UTC day (MCP services sharing an egress IP share its hourly allowance), and an additive SQLite table in the existing RegistryDO. The private `/stats` page includes the newest 100 submissions, distinct from anonymous counts, behind the existing `STATS_TOKEN` cookie. No new Cloudflare binding, namespace, secret or migration tag is needed.

Feedback notifications reuse `RESEND_API_KEY` and `EMAIL_FROM` (default `Incord <signin@incord.jesklabs.com>`), sent only to `incord-support@googlegroups.com`. Only the explicit reply address becomes `reply_to`. A hard shared cap reserves at most 30 feedback email attempts per UTC day; stored-only feedback is summarized as “N more stored” in a later notification. Provider failure does not undo a saved message or invite duplicate UI retries. Local `EMAIL_TEST_SINK=1` on localhost suppresses real delivery; tests mock Resend. Do not log messages, contacts, metadata, tokens or raw identities.
