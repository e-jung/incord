# Backend contract

All writes require `Origin` equal to the app origin and JSON bodies (except DELETE).
Session and temporary WebAuthn/OAuth flow cookies are HttpOnly, Secure on HTTPS, SameSite=Lax.
Set local `SESSION_SECRET` (32+ characters) using `.dev.vars`; never commit real credentials.
`wrangler dev --local --port 8793 --var SESSION_SECRET:local-development-only-secret-32chars` is sufficient for development.

- GET `/api/config`: `{passkeys,email,google,googleEnabled,push,vapidPublicKey}`. Hide Google unless googleEnabled. Push false means VAPID secrets missing.
- GET `/api/me`: `{user:{id,displayName,createdAt,settings,hasPasskey,hasEmail,hasGoogle}, recoveryCode?}` or 401. Email/Google sign-in does not generate recovery codes. Flags expose available sign-in methods, never the address.
- POST `/api/auth/email/start` `{email,link?:true}` → `{ok:true,message}`. Trim/lowercase address, 6-digit cryptographically random code valid 10 minutes; same response for known/new addresses. Max 3 sends/email and 10/IP per 15 minutes. Email and code are stored only as domain-separated HMAC-SHA256 hashes with SESSION_SECRET. Delivery uses RESEND_API_KEY; EMAIL_FROM defaults to Incord <signin@incord.jesklabs.com>. All login emails set reply_to to incord-support@googlegroups.com. Disabled without Resend credentials.
- POST `/api/auth/email/verify` `{email,code,link?:true}` → `{user}` and session cookie. Five attempts, then burned; single use. Creates account if new. Linking requires a valid session both at start and verify, and the same uid; conflicting owners return 409 after verification.
- GET `/api/test/last-code?email=…` → `{code}` ONLY when EMAIL_TEST_SINK is exactly `1` AND request hostname is localhost/127.0.0.1. In that mode delivery is intercepted locally. Otherwise 404, even if the test flag is set on a public host. Never set this flag in production.
- POST `/api/auth/register/options` `{displayName?}` (also accepts `name`). Returns SimpleWebAuthn options directly. On an authenticated session adds another passkey to that account; otherwise creates an account.
- POST `/api/auth/register/verify` `{response: RegistrationResponseJSON}` → `{user,recoveryCode}`. Show replacement recovery code once for passkey-only accounts; email/Google accounts receive none.
- POST `/api/auth/login/options` `{}` → SimpleWebAuthn options (discoverable credentials).
- POST `/api/auth/login/verify` `{response: AuthenticationResponseJSON}` → `{user}`.
- POST `/api/auth/recover` `{code}` → `{user,recoveryCode}`. Original code consumed atomically; replacement returned once for passkey-only accounts. Existing device sessions remain valid. Link an email from Account to migrate away from passkeys.
- POST `/api/auth/logout` `{}` clears this device's session.
- GET `/api/auth/google` → OAuth redirect with PKCE + single-use state; callback `/api/auth/google/callback` redirects to `/?signedIn=1`. Enable with GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET and register exact callback URL at Google. Existing Google subject mappings win; otherwise Google-authoritative verified email (Gmail or matching Workspace hd domain) links to the same keyed-email identity as email-code sign-in. Requests openid/profile/email scopes.
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
