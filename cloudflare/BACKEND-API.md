# Backend contract

All writes require `Origin` equal to the app origin and JSON bodies (except DELETE).
Session and temporary WebAuthn/OAuth flow cookies are HttpOnly, Secure on HTTPS, SameSite=Lax.
Set local `SESSION_SECRET` (32+ characters) using `.dev.vars`; never commit real credentials.
`wrangler dev --local --port 8793 --var SESSION_SECRET:local-development-only-secret-32chars` is sufficient for development.

- GET `/api/config`: `{passkeys,google,googleEnabled,push,vapidPublicKey}`. Hide Google unless googleEnabled. Push false means VAPID secrets missing.
- GET `/api/me`: `{user:{id,displayName,createdAt,settings,hasPasskey}, recoveryCode?}` or 401. Google first sign-in generates recovery on this first call; display it once.
- POST `/api/auth/register/options` `{displayName?}` (also accepts `name`). Returns SimpleWebAuthn options directly. On an authenticated session adds another passkey to that account; otherwise creates an account.
- POST `/api/auth/register/verify` `{response: RegistrationResponseJSON}` → `{user,recoveryCode}`. Always show replacement recovery code once.
- POST `/api/auth/login/options` `{}` → SimpleWebAuthn options (discoverable credentials).
- POST `/api/auth/login/verify` `{response: AuthenticationResponseJSON}` → `{user}`.
- POST `/api/auth/recover` `{code}` → `{user,recoveryCode}`. Original code consumed atomically; replacement returned once. All previous sessions revoked. Register a passkey on the recovered device via register/options and verify.
- POST `/api/auth/logout` `{}` clears this device's session.
- GET `/api/auth/google` → OAuth redirect with PKCE + single-use state; callback `/api/auth/google/callback` redirects to `/?signedIn=1`. Enable with GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET and register exact callback URL at Google. Google login creates/uses its own identity; no email-based linking.
- POST `/api/sync` `{items:[],events:[],settings?:{updatedAt,...}}` → `{items,events,settings,serverTime}`. Full snapshot including tombstones. Items require `{id,updatedAt}`; any remaining fields are preserved. updatedAt: milliseconds or ISO timestamp. `deleted:true` is a tombstone, not hard deletion. LWW per item; equal timestamps use deterministic serialized-JSON ordering. Events require `{id,at}` (also accepts timestamp or createdAt), are append-only and deduplicated by id. Sync batches max 1000 items / 2000 events, account max 10,000 items / 100,000 events. Settings **require updatedAt**, LWW object merge. Fields: displayName, appearance(system/light/dark), weeklyGoal(3/4/5/7), reminderTime(HH:mm), timezone(IANA), remindersEnabled. Frontend aliases name/theme/goal/timeZone/pushEnabled accepted and preserved. Always merge response settings as well as items/events. Client should monotonically bump settings.updatedAt on each settings edit and initialize it for pre-existing local state.
- GET `/api/export` → downloadable JSON, no credentials, secrets or subscriptions.
- DELETE `/api/account` → `{ok:true}`, destroys user storage, registry mappings, schedule and cookie. Client owns local practice data and can explicitly clear IndexedDB if desired.
- POST `/api/push/subscribe` `{subscription:PushSubscription.toJSON()}` → `{ok:true}`; `{subscription:null}` unsubscribes all devices, or `{enabled:false,endpoint}` removes one. Up to five devices.
- POST `/api/push/test` `{}` → `{sent,failed}` (3/min). Real delivery requires configured VAPID keys and genuine subscription.

Cron every 15 minutes checks due users (up to 200/batch). Reminders are reserved once per local calendar day in a 15-minute window after reminderTime, only with due/non-deleted items, no practice event that local day, and remindersEnabled. DST uses IANA timezone. Expired 404/410 subscriptions removed. Push encryption implements RFC8291 aes128gcm and VAPID ES256. Supported public push providers: Google/FCM, Mozilla, Apple, Windows; redirects refused. VAPID_PUBLIC_KEY is the uncompressed raw P-256 public key (65 bytes, base64url); VAPID_PRIVATE_KEY is the raw 32-byte private scalar (base64url); VAPID_SUBJECT is a contact mailto URL.

Optional APP_ORIGIN pins host/origin. Auth rate limit 60 requests per IP per 15 min, IP stored only as secret-salted SHA256. API body capped at 2 MB including chunked data. Auth requires user verification; no attestation. No provider API for licensed ESV is included (not launch brief scope).

## Verified checks

- `npx tsc -p tsconfig.worker.json`
- `npx vitest run --config cloudflare/vitest.config.ts` (6 security/crypto tests)
- `API_BASE_URL=http://localhost:8793 npx playwright test --config cloudflare/api.playwright.config.ts` (3 real Worker/SQLite/WebAuthn journeys)

Use **localhost**, not 127.0.0.1, for WebAuthn: browsers reject IP-address RP IDs. The API tests run a Chromium virtual resident-key authenticator via CDP. The isolated API test config expects an already-running local Worker. Main Playwright config may run this same spec alongside UI journeys. Backend crypto tests have a separate config because the main Vitest config only includes engine tests. Google live-provider callback and real push delivery are not verified without operator credentials/subscriptions.
