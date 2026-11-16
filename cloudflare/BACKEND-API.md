# Backend contract

All writes require `Origin` equal to the app origin and JSON bodies (except DELETE).
Session and temporary OAuth flow cookies are HttpOnly, Secure on HTTPS, SameSite=Lax.
Set local `SESSION_SECRET` (32+ characters) using `.dev.vars`; never commit real credentials.
`wrangler dev --local --port 8793 --var SESSION_SECRET:local-development-only-secret-32chars` enables the worker for development; email delivery requires the Accounts service binding (test suites use a separate local fake).

- GET `/api/config`: `{email,google,googleEnabled,push,vapidPublicKey}`. Also includes `accountsGoogle`, controlled by `ACCOUNTS_GOOGLE=1`. Hide Google unless googleEnabled. Push false means VAPID secrets missing.
- GET `/api/me`: `{user:{id,displayName,createdAt,settings,hasEmail,hasGoogle}}` or 401. Flags expose available sign-in methods, never the address.
- POST `/api/auth/email/start` `{email,link?:true}` → `{ok:true}`. Calls Accounts v1 `startEmail({email,ip})` using trusted CF-Connecting-IP. Accounts owns code delivery, hashes and rate limits. Incord does not send sign-in mail or use its retired email-code tables.
- POST `/api/auth/email/verify` `{email,code,link?:true}` → `{user,ssoTicket}` and unchanged host-only session cookie. Resolve pairwise `jl` subject first, then lazily match existing email fingerprint, otherwise create uid. Link mode never steals another account's identity (409). Browser immediately navigates to Accounts `/sso/attach?ticket=…&client=incord&return=…`; ticket is never logged/stored.
- GET `/api/auth/jesklabs?provider=google[&link=1]&return=<relative path>` → Accounts authorize, even while the Google button still uses legacy Google. `?prompt=none` checks SSO only after a user tap. Store random state, PKCE verifier, optional link uid and validated return server-side; browser has only host-only HttpOnly Secure Lax `__Host-jl_auth` challenge id (10 min).
- GET `/auth/jesklabs/callback` validates browser state and one-use challenge, then exchanges the grant via RPC. Explicit Google creates the Incord session; silent SSO stores an expiring pending identity and redirects to `/?jlConfirm=1`, never creates a session yet. `login_required` shows normal options.
- GET `/api/auth/jesklabs/pending` → masked email only. POST `/api/auth/jesklabs/confirm` consumes same-browser pending identity and issues `{user,returnPath}`; POST `/api/auth/jesklabs/cancel` discards it. Same-origin writes required.
- All RPC errors have calm user copy; binding outages map to generic retry and 503. No cookies contain `Domain=`. No client fetch/CORS to Accounts.
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
- `npx vitest run tests/backend.unit.test.ts tests/email-auth.unit.test.ts tests/incord.unit.test.ts` (security, email/Google identity and legacy-host contracts)
- `API_BASE_URL=http://localhost:8793 npx playwright test --config cloudflare/api.playwright.config.ts` (real Worker/SQLite email-auth and sync journeys)

Use localhost for the test-only fake mailbox. The API tests sign in using six-digit email codes against real local Incord SQLite Durable Objects and the contract-compatible fake Accounts binding. The isolated API test config expects the test adapter, not the production Worker with EMAIL_TEST_SINK alone. Main Playwright config starts both disposable Workers automatically. Google live-provider callback and real push delivery are not verified without operator credentials/subscriptions.

Passkey registration/login and recovery-code routes are removed (404). `/api/config` and user responses expose no passkey flags or recovery codes. Existing credential SQL tables are retained, unused; there is no destructive migration. The legacy host retains page 301 redirects, API 410 responses and the unregistering service worker; it no longer serves related-origin WebAuthn metadata.

## Invite-only groups

`GROUPS` binds the SQLite-backed `GroupDO`; additive migration `v4-groups` creates it on deployment. Existing Worker, UserDO and registry identities do not change. No KV/D1 or manual Cloudflare provisioning is required. All public routes use the existing session and same-origin write checks.

- `GET /api/groups`, `POST /api/groups {name, approveNewMembers?}`, and `GET /api/groups/:id` list/create/read authorized groups. The list also includes safe pending request summaries; `/leave` withdraws a request after reload. Limits: 3 owned, 5 memberships (pending reservations included), 30 active members.
- `POST /api/groups/join {code}` accepts the 16-character invite alphabet, case-insensitive and optionally hyphenated. `/join/:code` preserves the invite through sign-in. Raw codes are returned only on generation; indexes store hashes. Attempts are limited per account and hashed IP.
- `POST /api/groups/:id/invite {expiresDays?,maxUses?}` defaults to 14 days/20 uses. `/invite/revoke` invalidates it. Owner/admin can manage invites, goals and approvals; owner alone manages roles, ownership transfer and deletion.
- `/update`, `/approve {memberId}`, `/remove {memberId}`, `/role {memberId,role}`, `/transfer {memberId}`, `/leave`, and `DELETE /api/groups/:id` manage membership. Member IDs are group-scoped opaque identifiers, never account IDs. Owners must transfer or delete before leaving. Account deletion removes memberships and deletes owned groups.
- `POST /api/groups/:id/goal {selection}` takes a Discover passage/topic/starter/document selection (document ranges are inclusive question/article numbers). `POST /goal/add {}` inserts canonical items through UserDO’s sync merge, preserving existing edits/progress and ESV limits; origin is `group`. ESV goals contain reference metadata only.
- `POST /api/groups/:id/pray {memberId}` sends at most one prayer encouragement per sender/recipient/day, respecting the recipient’s global opt-out and push preference. `POST /weekly {enabled}` controls the per-group weekly summary. Existing quarter-hour cron targets Sunday around 18:00 in each recipient’s time zone; no separate scheduler/resource.

Views read current allowlisted UserDO projections: chosen display name, practiced days, weekly goal, learned count, streak and goal status. Synced `groupShareTitles` defaults true; false omits titles/translations immediately after sync. `groupReceivePrayer` also defaults true. No text, email, account ID, grade, slip or detailed review log is exposed. Group storage does not snapshot private libraries. Removal/leave blocks future reads immediately. The read-only MCP `get_groups` uses the same projection and requires `library:read`; it cannot mutate groups.

## Accounts migration and lifecycle

- Authenticated `POST /stats/maintenance/accounts-import` is counts-only and dry run by default; `confirm:true` imports bounded batches of Google mappings missing a jl link. Positive finite non-future millisecond verification timestamps only. Idempotent and resumable; email-only mappings await lazy linking. Result counts: `google,imported,alreadyLinked,conflicts,errors,emailOnlyPendingLazy`.
- Legacy Google sign-in best-effort imports its verified Google subject; failure does not block sign-in.
- jl identities exclude accounts from orphan maintenance and count as another method for code removal. Identity flags combine existing mappings with Accounts getUser without leaking email.
- Export includes Accounts getUser metadata. Delete calls deleteLink for each jl subject before local deletion; failure returns 503 for retry, avoiding orphan shared identities.
