# By Heart
A little practice. A lasting word.

An offline-first mobile PWA for Scripture, catechisms, and creeds. Light/dark tactile UI, automatic first-letter learning ladder, FSRS review, local practice without an account, optional passkey sync and gentle Web Push.

## Run locally
Node 24 required.

```sh
npm ci
npx playwright install chromium
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
```

Screenshots are written to test-results/screens/. Tests use disposable localhost accounts and CDP virtual authenticators, never production data. Push subscription browser permissions are mocked; the backend tests exercise Web Push encryption.

## Content
Normal builds use committed generated public-domain JSON. Bible books download into the offline cache only when first opened; starter paths and full documents are in the offline shell. See content/SOURCES.md and scripts/build-content.py --help for the reproducible source pipeline.

## Production (after review)
Build assets, configure SESSION_SECRET (32+ random bytes), APP_ORIGIN, optional VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT, optional GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET. Configure Google's callback to /api/auth/google/callback. VAPID private key is the base64url P-256 scalar. Use the same stable session secret and VAPID key across releases. Wrangler config includes the 15-minute reminder cron and SQLite Durable Object migrations. No deploy/push has been performed.


## Live-stack smoke

With a local build and `npm run serve` running, use:

```sh
SMOKE_URL=http://localhost:8793 node scripts/prod-smoke.mjs
```

Without `SMOKE_URL`, the script targets https://byheart.jesklabs.com. It uses Chromium at the iPhone 15 viewport, learns John 3:16 through all four steps, registers a virtual passkey, confirms explicit ownership/sync and recovery on a second device, checks CSP/console, push configuration and service workers, then deletes its temporary account even if a check fails. It never saves recovery codes or browser profiles. Push keys must be configured; provider delivery is not exercised.

Local Wrangler commands disable route-based origin inference so WebAuthn sees `localhost`, not the production custom domain.
