import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server';

export interface Env {
  ASSETS: Fetcher;
  USERS: DurableObjectNamespace;
  REGISTRY: DurableObjectNamespace;
  SESSION_SECRET: string;
  APP_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
type ObjectData = Record<string, unknown>;
type Row = Record<string, string | number | null>;
type Session = { uid: string; version: number; exp: number };
type Challenge = { challenge: string; kind: string; uid?: string; verifier?: string; name?: string };
const encoder = new TextEncoder();
const SESSION_AGE = 30 * 86400;
const cookieName = 'bh_session';
const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
function assert(ok: unknown, message = 'Invalid request', status = 400): asserts ok { if (!ok) throw new ApiError(status, message); }
export function b64(data: Uint8Array): string { return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
export function unb64(data: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
const random = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n)));
async function digest(value: string) { return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
async function hmac(secret: string, data: string) { const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))); }
export async function signSession(session: Session, secret: string) { const value = b64(encoder.encode(JSON.stringify(session))); return value + '.' + await hmac(secret, value); }
export async function readSession(value: string | undefined, secret: string): Promise<Session | null> {
  try { if (!value || value.length > 2048) return null; const [payload, signature, extra] = value.split('.'); if (extra || !signature) return null;
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, unb64(signature), encoder.encode(payload))) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64(payload))) as Session;
    return typeof s.uid === 'string' && /^[a-f0-9-]{36}$/.test(s.uid) && Number.isInteger(s.version) && s.exp > Date.now() / 1000 ? s : null;
  } catch { return null; }
}
function cookies(request: Request): Record<string, string> { return Object.fromEntries((request.headers.get('Cookie') || '').split(';').map(x => x.trim().split('=')).filter(x => x.length === 2)); }
function cookie(name: string, value: string, age: number, origin: string) { return `${name}=${value}; HttpOnly; ${origin.startsWith('https:') ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${age}`; }
async function body(request: Request): Promise<ObjectData> {
  assert(!request.headers.get('Content-Length') || Number(request.headers.get('Content-Length')) <= 2_000_000, 'Request too large', 413);
  assert(request.headers.get('Content-Type')?.includes('application/json'), 'Expected application/json', 415);
  // Stream cap also covers chunked requests without Content-Length.
  const reader = request.body?.getReader(); assert(reader, 'Missing body'); const parts: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2_000_000) { await reader.cancel(); throw new ApiError(413, 'Request too large'); } parts.push(part.value); }
  const bytes = new Uint8Array(size); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; }
  let result: unknown; try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400, 'Invalid JSON'); }
  assert(result && typeof result === 'object' && !Array.isArray(result)); return result as ObjectData;
}
function stub(env: Env, uid: string) { return env.USERS.get(env.USERS.idFromName(uid)); }
async function call(target: DurableObjectStub, path: string, data: unknown = {}) { const response = await target.fetch('https://internal' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!response.ok) { const problem = await response.json<{ error: string }>(); throw new ApiError(response.status, problem.error); } return response.json<any>(); }
const registry = (env: Env, path: string, data: unknown = {}) => call(env.REGISTRY.get(env.REGISTRY.idFromName('registry')), path, data);
const user = (env: Env, uid: string, path: string, data: unknown = {}) => call(stub(env, uid), path, data);
function secure(response: Response) { const headers = new Headers(response.headers); headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'no-referrer'); headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"); return new Response(response.body, { status: response.status, headers }); }
async function issue(env: Env, uid: string, origin: string, extra: ObjectData = {}) { const me = await user(env, uid, '/me'); const token = await signSession({ uid, version: me.version, exp: Math.floor(Date.now() / 1000) + SESSION_AGE }, env.SESSION_SECRET); return json({ user: me.user, ...extra }, 200, { 'Set-Cookie': cookie(cookieName, token, SESSION_AGE, origin) }); }
async function signedIn(request: Request, env: Env) { const s = await readSession(cookies(request)[cookieName], env.SESSION_SECRET); assert(s, 'Sign in required', 401); const me = await user(env, s.uid, '/me'); assert(me.version === s.version, 'Session expired', 401); return s; }
function originFor(request: Request, env: Env) { const origin = new URL(request.url).origin; if (env.APP_ORIGIN) assert(origin === new URL(env.APP_ORIGIN).origin, 'Wrong host', 403); return origin; }
async function authChallenge(env: Env, request: Request, kind: string) { const id = cookies(request).bh_flow; assert(id, 'Start sign-in again'); const flow = await registry(env, '/challenge/take', { id }); assert(flow && flow.kind === kind, 'Sign-in expired; start again'); return flow as Challenge; }
async function recoveryCode(env: Env, uid: string) { const code = random(24); await registry(env, '/recovery/set', { uid, hash: await digest(code) }); return code; }

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname, origin = originFor(request, env);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) assert(request.headers.get('Origin') === origin, 'Cross-origin write denied', 403);
  if (path === '/api/config' && request.method === 'GET') return json({ passkeys: true, google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), googleEnabled: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), push: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY), vapidPublicKey: env.VAPID_PUBLIC_KEY || null });
  assert(env.SESSION_SECRET?.length >= 32, 'Service secrets are not configured', 503);
  if (path.startsWith('/api/auth/')) {
    await registry(env, '/limit', { key: await digest(env.SESSION_SECRET + ':' + (request.headers.get('CF-Connecting-IP') || 'local')), limit: 60, window: 900_000 });
    const rpID = url.hostname;
    if (path === '/api/auth/register/options' && request.method === 'POST') {
      const input = await body(request), name = typeof (input.displayName ?? input.name) === 'string' ? String(input.displayName ?? input.name).trim().slice(0, 80) : 'Friend';
      const old = await readSession(cookies(request)[cookieName], env.SESSION_SECRET); let uid = crypto.randomUUID(); let credentials: any[] = [];
      if (old) { const me = await user(env, old.uid, '/me'); if (me.version === old.version) { uid = old.uid; credentials = (await user(env, uid, '/credentials')).credentials; } }
      const options = await generateRegistrationOptions({ rpName: 'By Heart', rpID, userName: uid, userDisplayName: name || 'Friend', userID: new Uint8Array(encoder.encode(uid)), attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, excludeCredentials: credentials.map(c => ({ id: c.id, transports: c.transports })) });
      const id = random(); await registry(env, '/challenge/set', { id, value: { challenge: options.challenge, kind: 'register', uid, name } }); return json(options, 200, { 'Set-Cookie': cookie('bh_flow', id, 300, origin) });
    }
    if (path === '/api/auth/register/verify' && request.method === 'POST') {
      const input = await body(request), flow = await authChallenge(env, request, 'register'); const response = (input.response || input) as unknown as RegistrationResponseJSON;
      let verification; try { verification = await verifyRegistrationResponse({ response, expectedChallenge: flow.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }); } catch { throw new ApiError(400, 'Passkey verification failed'); }
      assert(verification.verified && verification.registrationInfo, 'Passkey verification failed'); const credential = verification.registrationInfo.credential;
      await registry(env, '/credential/set', { id: credential.id, uid: flow.uid });
      await user(env, flow.uid!, '/credential/add', { name: flow.name, credential: { ...credential, publicKey: b64(credential.publicKey) } });
      const code = await recoveryCode(env, flow.uid!); return issue(env, flow.uid!, origin, { recoveryCode: code });
    }
    if (path === '/api/auth/login/options' && request.method === 'POST') {
      await body(request); const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' }); const id = random();
      await registry(env, '/challenge/set', { id, value: { challenge: options.challenge, kind: 'login' } }); return json(options, 200, { 'Set-Cookie': cookie('bh_flow', id, 300, origin) });
    }
    if (path === '/api/auth/login/verify' && request.method === 'POST') {
      const input = await body(request), flow = await authChallenge(env, request, 'login'), response = (input.response || input) as unknown as AuthenticationResponseJSON;
      assert(typeof response.id === 'string'); const found = await registry(env, '/credential/get', { id: response.id }); assert(found.uid, "That passkey's account was deleted. Create an account to start again.", 401);
      const stored = await user(env, found.uid, '/credential/get', { id: response.id }); assert(stored.credential, "That passkey's account was deleted. Create an account to start again.", 401);
      const credential = { ...stored.credential, publicKey: unb64(stored.credential.publicKey) } as WebAuthnCredential;
      let verification; try { verification = await verifyAuthenticationResponse({ response, expectedChallenge: flow.challenge, expectedOrigin: origin, expectedRPID: rpID, credential, requireUserVerification: true }); } catch { throw new ApiError(401, 'Passkey verification failed'); }
      assert(verification.verified, 'Passkey verification failed', 401); await user(env, found.uid, '/credential/counter', { id: response.id, counter: verification.authenticationInfo.newCounter }); return issue(env, found.uid, origin);
    }
    if (path === '/api/auth/recover' && request.method === 'POST') {
      const { code } = await body(request); assert(typeof code === 'string' && code.length <= 200); const result = await registry(env, '/recovery/take', { hash: await digest(code.trim()) }); assert(result.uid, 'Invalid or already used recovery code', 401);
      return issue(env, result.uid, origin, { recoveryCode: await recoveryCode(env, result.uid) });
    }
    if (path === '/api/auth/logout-everywhere' && request.method === 'POST') { const session = await signedIn(request, env); await user(env, session.uid, '/revoke'); return json({ ok: true }, 200, { 'Set-Cookie': cookie(cookieName, '', 0, origin) }); }
    if (path === '/api/auth/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie(cookieName, '', 0, origin) });
    if (path === '/api/auth/google' && request.method === 'GET') {
      assert(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET, 'Google sign-in is not enabled', 404); const state = random(), verifier = random(48);
      await registry(env, '/challenge/set', { id: state, value: { kind: 'google', challenge: state, verifier } });
      const target = new URL('https://accounts.google.com/o/oauth2/v2/auth'); target.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: origin + '/api/auth/google/callback', response_type: 'code', scope: 'openid profile email', state, code_challenge: await digest(verifier), code_challenge_method: 'S256' }).toString();
      return new Response(null, { status: 302, headers: { Location: target.href, 'Set-Cookie': cookie('bh_flow', state, 300, origin), 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/auth/google/callback' && request.method === 'GET') {
      assert(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET, 'Google sign-in is not enabled', 404); assert(url.searchParams.get('state') === cookies(request).bh_flow, 'Invalid OAuth state'); const flow = await authChallenge(env, request, 'google'); const code = url.searchParams.get('code'); assert(code, 'Google sign-in cancelled');
      const tokens = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, code_verifier: flow.verifier!, grant_type: 'authorization_code', redirect_uri: origin + '/api/auth/google/callback' }) }); assert(tokens.ok, 'Google sign-in failed', 401);
      const token = await tokens.json<{ access_token: string }>(); const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + token.access_token } }); assert(profileResponse.ok, 'Google sign-in failed', 401);
      const profile = await profileResponse.json<{ sub: string; name?: string; email_verified?: boolean }>(); assert(profile.sub, 'Google profile missing', 401);
      const mapping = await registry(env, '/google', { sub: profile.sub }); await user(env, mapping.uid, '/init', { name: profile.name || 'Friend' });
      const login = await issue(env, mapping.uid, origin);
      if (mapping.created) await user(env, mapping.uid, '/recovery/pending', { needed: true });
      return new Response(null, { status: 302, headers: { Location: '/?signedIn=1', 'Set-Cookie': login.headers.get('Set-Cookie')!, 'Cache-Control': 'no-store' } });
    }
    throw new ApiError(404, 'Route not found');
  }
  let session: Session;
  try { session = await signedIn(request, env); } catch (error) { if (path === '/api/me' && request.method === 'GET' && error instanceof ApiError && error.status === 401) return json({ user: null }); throw error; }
  const uid = session.uid;
  if (path === '/api/me' && request.method === 'GET') { const me = await user(env, uid, '/me', { takeRecovery: true }); return json({ user: me.user, ...(me.needsRecovery ? { recoveryCode: await recoveryCode(env, uid) } : {}) }); }
  if (path === '/api/sync' && request.method === 'POST') { const input = await body(request); const result = await user(env, uid, '/sync', input); await registry(env, '/schedule/set', { uid }); return json(result); }
  if (path === '/api/export' && request.method === 'GET') return json(await user(env, uid, '/export'), 200, { 'Content-Disposition': 'attachment; filename="by-heart-export.json"' });
  if (path === '/api/account' && request.method === 'DELETE') { await user(env, uid, '/delete'); await registry(env, '/delete', { uid }); return json({ ok: true }, 200, { 'Set-Cookie': cookie(cookieName, '', 0, origin) }); }
  if (path === '/api/push/subscribe' && request.method === 'POST') { const input = await body(request); assert(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY, 'Push is not configured', 503); const result = await user(env, uid, '/push/subscribe', input); await registry(env, '/schedule/set', { uid }); return json(result); }
  if (path === '/api/push/test' && request.method === 'POST') { await registry(env, '/limit', { key: 'push:' + uid, limit: 3, window: 60_000 }); return json(await user(env, uid, '/push/test')); }
  throw new ApiError(404, 'Route not found');
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { if (new URL(request.url).pathname.startsWith('/api/')) return secure(await api(request, env)); return secure(await env.ASSETS.fetch(request)); }
    catch (error) { if (error instanceof ApiError) return secure(json({ error: error.message }, error.status)); console.error('By Heart API error', error instanceof Error ? error.name : 'unknown'); return secure(json({ error: 'Something went wrong. Please try again.' }, 500)); }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil((async () => { const { users } = await registry(env, '/schedule/due'); const results = await Promise.allSettled(users.map((uid: string) => user(env, uid, '/push/remind'))); if (results.some(r => r.status === 'rejected')) throw new Error('One or more reminder checks failed'); })()); },
} satisfies ExportedHandler<Env>;

export class RegistryDO {
  private sql: SqlStorage;
  constructor(private ctx: DurableObjectState) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS mapping(kind TEXT NOT NULL,id TEXT NOT NULL,uid TEXT NOT NULL,PRIMARY KEY(kind,id))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS mapping_user ON mapping(uid)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS schedule(uid TEXT PRIMARY KEY,next_at INTEGER NOT NULL)');
  }
  private rows(query: string, ...args: (string | number)[]) { return [...this.sql.exec<Row>(query, ...args)]; }
  async fetch(request: Request) { return this.ctx.blockConcurrencyWhile(async () => { try {
    const data = await request.json<any>(), path = new URL(request.url).pathname, now = Date.now();
    this.sql.exec('DELETE FROM challenges WHERE expires < ?', now); this.sql.exec('DELETE FROM limits WHERE expires < ?', now);
    if (path === '/limit') { const row = this.rows('SELECT count FROM limits WHERE id=?', data.key)[0]; assert(!row || Number(row.count) < data.limit, 'Too many requests. Try again later.', 429); this.sql.exec('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1', data.key, now + data.window); return json({ ok: true }); }
    if (path === '/challenge/set') { this.sql.exec('INSERT INTO challenges VALUES(?,?,?)', data.id, JSON.stringify(data.value), now + 300_000); return json({ ok: true }); }
    if (path === '/challenge/take') { const row = this.rows('SELECT value FROM challenges WHERE id=?', data.id)[0]; this.sql.exec('DELETE FROM challenges WHERE id=?', data.id); return json(row ? JSON.parse(String(row.value)) : null); }
    if (path === '/credential/set') { const old = this.rows('SELECT uid FROM mapping WHERE kind=? AND id=?', 'credential', data.id)[0]; assert(!old || old.uid === data.uid, 'Passkey already registered', 409); this.sql.exec('INSERT OR IGNORE INTO mapping VALUES(?,?,?)', 'credential', data.id, data.uid); return json({ ok: true }); }
    if (path === '/credential/get') return json(this.rows('SELECT uid FROM mapping WHERE kind=? AND id=?', 'credential', data.id)[0] || {});
    if (path === '/recovery/set') { this.ctx.storage.transactionSync(() => { this.sql.exec('DELETE FROM mapping WHERE kind=? AND uid=?', 'recovery', data.uid); this.sql.exec('INSERT INTO mapping VALUES(?,?,?)', 'recovery', data.hash, data.uid); }); return json({ ok: true }); }
    if (path === '/recovery/take') { const row = this.rows('SELECT uid FROM mapping WHERE kind=? AND id=?', 'recovery', data.hash)[0]; this.sql.exec('DELETE FROM mapping WHERE kind=? AND id=?', 'recovery', data.hash); return json(row || {}); }
    if (path === '/google') { const old = this.rows('SELECT uid FROM mapping WHERE kind=? AND id=?', 'google', data.sub)[0]; if (old) return json(old); const uid = crypto.randomUUID(); this.sql.exec('INSERT INTO mapping VALUES(?,?,?)', 'google', data.sub, uid); return json({ uid, created: true }); }
    if (path === '/schedule/set') { this.sql.exec('INSERT OR IGNORE INTO schedule VALUES(?,0)', data.uid); return json({ ok: true }); }
    if (path === '/schedule/due') { const users = this.rows('SELECT uid FROM schedule WHERE next_at<=? ORDER BY next_at LIMIT 200', now).map(row => row.uid); for (const uid of users) this.sql.exec('UPDATE schedule SET next_at=? WHERE uid=?', now + 15 * 60_000, uid); return json({ users }); }
    if (path === '/delete') { this.sql.exec('DELETE FROM mapping WHERE uid=?', data.uid); this.sql.exec("DELETE FROM challenges WHERE json_extract(value,'$.uid')=?", data.uid); this.sql.exec('DELETE FROM schedule WHERE uid=?', data.uid); return json({ ok: true }); }
    return json({ error: 'Not found' }, 404);
  } catch (e) { if (e instanceof ApiError) return json({ error: e.message }, e.status); throw e; } }); }
}

type SyncRecord = ObjectData & { id: string; updatedAt: number | string; deleted?: boolean };
export function timestamp(value: unknown) { const n = typeof value === 'string' ? Date.parse(value) : value; assert(typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Date.now() + 300_000, 'Invalid updatedAt'); return n; }
function record(value: unknown): asserts value is SyncRecord { assert(value && typeof value === 'object' && !Array.isArray(value)); const r = value as ObjectData; assert(typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 160, 'Invalid id'); assert(JSON.stringify(value).length <= 50_000, 'Item too large'); timestamp(r.updatedAt); }
export function localDay(now: Date, timezone: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
const settingAliases:Record<string,string>={name:'displayName',theme:'appearance',goal:'weeklyGoal',timeZone:'timezone',pushEnabled:'remindersEnabled'};
/** Per-field LWW; legacy records without field clocks use their record revision. */
export function mergeServerSettings(old:any,incoming:any){const result={...old,fieldUpdatedAt:{...old.fieldUpdatedAt}};for(const key of Object.keys(old))if(key!=='updatedAt'&&key!=='fieldUpdatedAt'&&result.fieldUpdatedAt[key]===undefined)result.fieldUpdatedAt[key]=old.fieldUpdatedAt?0:old.updatedAt??0;for(const key of Object.keys(incoming)){if(key==='updatedAt'||key==='fieldUpdatedAt')continue;const before=old.fieldUpdatedAt?.[key]??(old.fieldUpdatedAt?0:old.updatedAt??0),after=incoming.fieldUpdatedAt?.[key]??(incoming.fieldUpdatedAt?0:incoming.updatedAt??0);if(after>before||(after===before&&JSON.stringify(incoming[key])>JSON.stringify(old[key]))){result[key]=incoming[key];result.fieldUpdatedAt[key]=after}}result.updatedAt=Math.max(old.updatedAt||0,incoming.updatedAt||0);return result}
export function settingsRecord(input: unknown): ObjectData { assert(input && typeof input === 'object' && !Array.isArray(input), 'Invalid settings'); const s = { ...(input as ObjectData) }; timestamp(s.updatedAt);
  if (s.name !== undefined) s.displayName = s.name; if (s.theme !== undefined) s.appearance = s.theme; if (s.goal !== undefined) s.weeklyGoal = s.goal; if (s.timeZone !== undefined) s.timezone = s.timeZone; if (s.pushEnabled !== undefined) s.remindersEnabled = s.pushEnabled;
  if (s.remindersEnabled !== undefined) assert(typeof s.remindersEnabled === 'boolean', 'Invalid reminder setting');
  if (s.displayName !== undefined) { assert(typeof s.displayName === 'string' && s.displayName.length <= 80, 'Invalid display name'); s.name = s.displayName = s.displayName.trim(); }
  if (s.weeklyGoal !== undefined) assert([3, 4, 5, 7].includes(Number(s.weeklyGoal)), 'Invalid weekly goal');
  if (s.appearance !== undefined) assert(['system', 'light', 'dark'].includes(String(s.appearance)), 'Invalid appearance');
  if (s.reminderTime !== undefined) assert(typeof s.reminderTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.reminderTime), 'Invalid reminder time');
  if (s.newPerDay !== undefined) assert([1,2,3,5].includes(Number(s.newPerDay)), 'Invalid daily limit');
  if (s.timezone !== undefined) { assert(typeof s.timezone === 'string' && s.timezone.length > 0, 'Invalid timezone'); try { new Intl.DateTimeFormat('en', { timeZone: String(s.timezone) }).format(); } catch { throw new ApiError(400, 'Invalid timezone'); } }
  if(s.fieldUpdatedAt !== undefined) { assert(s.fieldUpdatedAt && typeof s.fieldUpdatedAt === 'object' && !Array.isArray(s.fieldUpdatedAt), 'Invalid field timestamps'); for(const value of Object.values(s.fieldUpdatedAt)) timestamp(value); const times = {...s.fieldUpdatedAt as Record<string,unknown>}; for(const [from,to] of Object.entries(settingAliases)) if(times[from] !== undefined) times[to] = times[from]; s.fieldUpdatedAt = times; }
  assert(JSON.stringify(s).length < 10_000, 'Settings too large'); return s;
}
export class UserDO {
  private sql: SqlStorage;
  constructor(private ctx: DurableObjectState, private env: Env) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,value TEXT NOT NULL,updated INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY,value TEXT NOT NULL)');
  }
  private rows(query: string, ...args: (string | number)[]) { return [...this.sql.exec<Row>(query, ...args)]; }
  private get(key: string): any { const row = this.rows('SELECT value FROM meta WHERE key=?', key)[0]; return row ? JSON.parse(String(row.value)) : null; }
  private set(key: string, value: unknown) { this.sql.exec('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  private list(table: string) { assert(['items', 'events', 'credentials', 'subscriptions'].includes(table)); return this.rows(`SELECT value FROM ${table} ORDER BY ${table === 'subscriptions' ? 'endpoint' : 'id'}`).map(row => JSON.parse(String(row.value))); }
  private settings() { return this.get('settings') || { appearance: 'system', weeklyGoal: 4, reminderTime: '09:00', timezone: 'UTC', remindersEnabled: false, updatedAt: 0 }; }
  async fetch(request: Request) { return this.ctx.blockConcurrencyWhile(async () => { try {
    const data = await request.json<any>(), path = new URL(request.url).pathname;
    if (path === '/delete') { await this.ctx.storage.deleteAll(); this.sql.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)'); this.set('deleted', true); return json({ ok: true }); }
    assert(!this.get('deleted'), 'Account no longer exists', 401);
    if (path === '/init' || path === '/credential/add') {
      if (!this.get('profile')) { this.set('profile', { id: this.ctx.id.toString(), displayName: data.name || 'Friend', createdAt: Date.now() }); this.set('version', 1); }
      if (path === '/credential/add') { assert(this.rows('SELECT COUNT(*) AS n FROM credentials')[0].n as number < 20, 'Passkey limit reached'); this.sql.exec('INSERT INTO credentials VALUES(?,?)', data.credential.id, JSON.stringify(data.credential)); }
      return json({ ok: true });
    }
    assert(this.get('profile'), 'Account not found', 401);
    if (path === '/me') { const needsRecovery = data.takeRecovery ? this.get('pendingRecovery') : null; if (needsRecovery) this.sql.exec('DELETE FROM meta WHERE key=?', 'pendingRecovery'); const profile = this.get('profile'); return json({ user: { ...profile, displayName: this.settings().displayName === undefined ? profile.displayName : (this.settings().displayName || 'Friend'), settings: this.settings(), hasPasskey: this.rows('SELECT COUNT(*) AS n FROM credentials')[0].n as number > 0 }, version: this.get('version'), ...(needsRecovery ? { needsRecovery: true } : {}) }); }
    if (path === '/revoke') { this.set('version', this.get('version') + 1); return json({ ok: true }); }
    if (path === '/recovery/pending') { this.set('pendingRecovery', !!data.needed); return json({ ok: true }); }
    if (path === '/credentials') return json({ credentials: this.list('credentials') });
    if (path === '/credential/get') return json({ credential: this.list('credentials').find(c => c.id === data.id) || null });
    if (path === '/credential/counter') { const credential = this.list('credentials').find(c => c.id === data.id); assert(credential, 'Unknown credential'); credential.counter = Math.max(credential.counter, data.counter); this.sql.exec('UPDATE credentials SET value=? WHERE id=?', JSON.stringify(credential), data.id); return json({ ok: true }); }
    if (path === '/sync') {
      const items = data.items || [], events = data.events || []; assert(Array.isArray(items) && items.length <= 1000 && Array.isArray(events) && events.length <= 2000, 'Sync batch too large');
      for (const item of items) record(item);
      for (const event of events) { assert(event && typeof event.id === 'string' && event.id.length > 0 && event.id.length <= 160 && JSON.stringify(event).length <= 10_000, 'Invalid event'); assert(event.timestamp !== undefined || event.createdAt !== undefined || event.at !== undefined, 'Event needs timestamp, createdAt, or at'); timestamp(event.timestamp ?? event.createdAt ?? event.at); }
      const settings = data.settings ? settingsRecord(data.settings) : null;
      this.ctx.storage.transactionSync(() => {
        assert(Number(this.rows('SELECT COUNT(*) AS n FROM items')[0].n) + items.filter((i: SyncRecord) => !this.rows('SELECT id FROM items WHERE id=?', i.id).length).length <= 10_000, 'Account item limit reached');
        assert(Number(this.rows('SELECT COUNT(*) AS n FROM events')[0].n) + events.filter((e: ObjectData) => !this.rows('SELECT id FROM events WHERE id=?', String(e.id)).length).length <= 100_000, 'Account review log limit reached');
        for (const item of items as SyncRecord[]) {
          const serialized = JSON.stringify(item), updated = timestamp(item.updatedAt); const existing = this.rows('SELECT updated,value FROM items WHERE id=?', item.id)[0];
          // Equal-timestamp conflicts converge deterministically, independent of arrival order.
          if (!existing || updated > Number(existing.updated) || (updated === Number(existing.updated) && serialized > String(existing.value))) this.sql.exec('INSERT INTO items VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated=excluded.updated', item.id, serialized, updated);
        }
        for (const event of events) this.sql.exec('INSERT OR IGNORE INTO events VALUES(?,?)', event.id, JSON.stringify(event));
        if (settings) this.set('settings', mergeServerSettings(this.settings(), settings));
      });
      return json({ items: this.list('items'), events: this.list('events'), settings: this.settings(), serverTime: Date.now() });
    }
    if (path === '/export') return json({ format: 'by-heart', version: 1, exportedAt: new Date().toISOString(), user: { ...this.get('profile'), displayName: this.settings().displayName === undefined ? this.get('profile').displayName : (this.settings().displayName || 'Friend') }, items: this.list('items'), events: this.list('events'), settings: this.settings() });
    if (path === '/push/subscribe') {
      if (data.subscription === null || data.enabled === false) { if (data.endpoint) this.sql.exec('DELETE FROM subscriptions WHERE endpoint=?', data.endpoint); else this.sql.exec('DELETE FROM subscriptions'); return json({ ok: true }); }
      const sub = (data.subscription || data) as PushSubscriptionData; validateSubscription(sub); assert(this.list('subscriptions').length < 5 || this.rows('SELECT endpoint FROM subscriptions WHERE endpoint=?', sub.endpoint).length, 'Device limit reached');
      this.sql.exec('INSERT INTO subscriptions VALUES(?,?) ON CONFLICT(endpoint) DO UPDATE SET value=excluded.value', sub.endpoint, JSON.stringify(sub)); return json({ ok: true });
    }
    if (path === '/push/test') return json(await this.sendPush(true));
    if (path === '/push/remind') return json(await this.sendPush(false));
    return json({ error: 'Not found' }, 404);
  } catch (e) { if (e instanceof ApiError) return json({ error: e.message }, e.status); throw e; } }); }
  private async sendPush(test: boolean) {
    assert(this.env.VAPID_PRIVATE_KEY && this.env.VAPID_PUBLIC_KEY, 'Push is not configured', 503); const settings = this.settings(), now = new Date(), today = localDay(now, settings.timezone || 'UTC');
    if (!test) {
      if (!settings.remindersEnabled || this.get('remindedDay') === today) return { sent: 0 };
      const clock = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone || 'UTC', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now);
      // Cron is quarter-hourly: permit the 15-minute window following the chosen time.
      const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)); const delta = (minutes(clock) - minutes(settings.reminderTime || '09:00') + 1440) % 1440; if (delta >= 15) return { sent: 0 };
      if (this.list('events').some(e => localDay(new Date(e.timestamp ?? e.createdAt ?? e.at), settings.timezone || 'UTC') === today)) return { sent: 0 };
      const due = this.list('items').some(i => !i.deleted && (!i.learned || !i.due && !i.dueAt && !i.card?.due || new Date(i.dueAt ?? i.due ?? i.card?.due).getTime() <= now.getTime())); if (!due) return { sent: 0 };
      this.set('remindedDay', today); // Reserve before network I/O, so retries cannot duplicate a daily reminder.
    }
    let sent = 0, failed = 0;
    for (const sub of this.list('subscriptions')) { try { const response = await sendWebPush(sub, { title: 'By Heart', body: test ? 'Your gentle reminders are ready.' : 'A quiet moment to keep a little truth by heart.', url: '/', tag: test ? 'by-heart-test' : 'by-heart-daily' }, this.env); if (response.status === 404 || response.status === 410) this.sql.exec('DELETE FROM subscriptions WHERE endpoint=?', sub.endpoint); else if (response.ok) sent++; else failed++; } catch { failed++; } }
    return { sent, failed };
  }
}

type PushSubscriptionData = { endpoint: string; keys: { p256dh: string; auth: string } };
export function validateSubscription(sub: PushSubscriptionData) {
  assert(sub && typeof sub.endpoint === 'string' && sub.endpoint.length < 2048 && sub.keys, 'Invalid push subscription');
  let endpoint: URL; try { endpoint = new URL(sub.endpoint); } catch { throw new ApiError(400, 'Invalid push endpoint'); } const host = endpoint.hostname;
  assert(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && (!endpoint.port || endpoint.port === '443') && (host === 'fcm.googleapis.com' || host === 'android.googleapis.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com') || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com')), 'Unsupported push service');
  try { assert(unb64(sub.keys.p256dh).length === 65 && unb64(sub.keys.auth).length === 16, 'Invalid subscription keys'); } catch { throw new ApiError(400, 'Invalid subscription keys'); }
}
function concat(...parts: Uint8Array[]) { const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const part of parts) { all.set(part, at); at += part.length; } return all; }
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) { const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8)); }
export async function sendWebPush(subscription: PushSubscriptionData, payload: unknown, env: Env): Promise<Response> {
  validateSubscription(subscription); const uaPublic = unb64(subscription.keys.p256dh), auth = unb64(subscription.keys.auth);
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair; const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, pair.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32), salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const clear = concat(encoder.encode(JSON.stringify(payload)), new Uint8Array([2])); assert(clear.length < 3993, 'Push payload too large');
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']); const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, clear));
  const header = new Uint8Array(21); header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPublic.length;
  const vapid = unb64(env.VAPID_PUBLIC_KEY!); assert(vapid.length === 65, 'Invalid VAPID public key', 503);
  const signingKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64(vapid.slice(1, 33)), y: b64(vapid.slice(33)), d: env.VAPID_PRIVATE_KEY!, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const unsigned = b64(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) + '.' + b64(encoder.encode(JSON.stringify({ aud: new URL(subscription.endpoint).origin, exp: Math.floor(Date.now() / 1000) + 3600, sub: env.VAPID_SUBJECT || 'mailto:hello@jesklabs.com' })));
  const signature = b64(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(unsigned))));
  return fetch(subscription.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { TTL: '3600', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: `vapid t=${unsigned}.${signature}, k=${env.VAPID_PUBLIC_KEY}` }, body: concat(header, asPublic, cipher) });
}
