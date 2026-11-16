import { normalizeCode } from '../../shared/sign-in-code';
import {
  accountsCall,
  AccountsError,
  accountsReturnPath,
  maskedEmail,
  type AccountsIdentity,
} from '../accounts';
import {
  ApiError,
  assert,
  b64,
  body,
  constantTimeEqual,
  digest,
  encoder,
  hmac,
  json,
  random,
  registry,
  unb64,
  user,
} from './common';
import { Challenge, Env, ObjectData, Session } from './types';

export const SESSION_AGE = 30 * 86400;

export const cookieName = 'bh_session';

/** Stable auth limiter identity: IPv4 hosts, IPv6 /64s, and mapped IPv4 hosts.
 * URL's IPv6 parser handles compressed/canonical and embedded IPv4 forms. Invalid
 * or missing proxy addresses share one fallback rather than minting buckets.
 */
export function authIpBucket(address: string | null): string {
  if (!address) return 'local';
  const ipv4 = address.split('.');
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
  )
    return address;
  if (!/^[0-9a-f:.]+$/i.test(address) || !address.includes(':')) return 'local';
  try {
    const canonical = new URL('http://[' + address + ']/').hostname.slice(1, -1);
    const halves = canonical.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const words = (
      halves.length === 2
        ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
        : left
    ).map((word) => parseInt(word, 16));
    if (words.length !== 8) return 'local';
    // Do not collapse all IPv4-mapped clients into the same ::/64.
    if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff)
      return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
    return (
      words
        .slice(0, 4)
        .map((word) => word.toString(16).padStart(4, '0'))
        .join(':') + '::/64'
    );
  } catch {
    return 'local';
  }
}

export function normalizeEmail(value: unknown) {
  assert(typeof value === 'string', 'Enter a valid email address.');
  const email = value.trim().toLowerCase();
  assert(
    email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email),
    'Enter a valid email address.',
  );
  return email;
}

export const signInCodeKey = (env: Env, code: unknown) =>
  hmac(env.SESSION_SECRET, 'signin-code:' + normalizeCode(code));

export const emailKey = (env: Env, email: string) =>
  hmac(env.SESSION_SECRET, 'email:' + normalizeEmail(email));

export function emailTestMode(env: Env, request: Request) {
  return (
    env.EMAIL_TEST_SINK === '1' &&
    ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname)
  );
}

export function emailEnabled(env: Env, _request: Request) {
  return !!env.ACCOUNTS_SVC;
}

export async function accountsUsers(env: Env, uid: string) {
  const { subs } = await registry(env, '/jl/links', { uid });
  return Promise.all(
    (subs as string[]).map((sub) => accountsCall(env.ACCOUNTS_SVC, 'getUser', { sub })),
  );
}

export async function identityFlags(env: Env, uid: string) {
  const flags = await registry(env, '/identity', { uid });
  // Existing sessions remain usable during an Accounts outage. Never invent flags.
  try {
    for (const account of await accountsUsers(env, uid))
      if (account) {
        flags.hasEmail ||= !!account.email;
        flags.hasGoogle ||= account.hasGoogle;
      }
  } catch {
    /* preserve local known methods */
  }
  return flags;
}

export async function resolveAccounts(env: Env, identity: AccountsIdentity, uid?: string) {
  const result = await registry(env, '/jl/resolve', {
    requireReady: true,
    sub: identity.sub,
    ...(identity.email ? { emailKey: await emailKey(env, identity.email) } : {}),
    ...(uid ? { uid } : {}),
  });
  await user(env, result.uid, '/init', { name: 'Friend' });
  return result.uid as string;
}

export async function signSession(session: Session, secret: string) {
  const value = b64(encoder.encode(JSON.stringify(session)));
  return value + '.' + (await hmac(secret, value));
}

export async function readSession(
  value: string | undefined,
  secret: string,
): Promise<Session | null> {
  try {
    if (!value || value.length > 2048) return null;
    const [payload, signature, extra] = value.split('.');
    if (extra || !signature) return null;
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    if (!(await crypto.subtle.verify('HMAC', key, unb64(signature), encoder.encode(payload))))
      return null;
    const s = JSON.parse(new TextDecoder().decode(unb64(payload))) as Session;
    return typeof s.uid === 'string' &&
      /^[a-f0-9-]{36}$/.test(s.uid) &&
      Number.isInteger(s.version) &&
      s.exp > Date.now() / 1000
      ? s
      : null;
  } catch {
    return null;
  }
}

export function cookies(request: Request): Record<string, string> {
  return Object.fromEntries(
    (request.headers.get('Cookie') || '')
      .split(';')
      .map((x) => x.trim().split('='))
      .filter((x) => x.length === 2),
  );
}

export function cookie(name: string, value: string, age: number, origin: string) {
  return `${name}=${value}; HttpOnly; ${origin.startsWith('https:') ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${age}`;
}

export async function issue(env: Env, uid: string, origin: string, extra: ObjectData = {}) {
  const me = await user(env, uid, '/me');
  const token = await signSession(
    { uid, version: me.version, exp: Math.floor(Date.now() / 1000) + SESSION_AGE },
    env.SESSION_SECRET,
  );
  return json({ user: { ...me.user, ...(await identityFlags(env, uid)) }, ...extra }, 200, {
    'Set-Cookie': cookie(cookieName, token, SESSION_AGE, origin),
  });
}

export async function signedIn(request: Request, env: Env) {
  const s = await readSession(cookies(request)[cookieName], env.SESSION_SECRET);
  assert(s, 'Sign in required', 401);
  const me = await user(env, s.uid, '/me');
  assert(me.version === s.version, 'Session expired', 401);
  return s;
}

export function originFor(request: Request, env: Env) {
  const origin = new URL(request.url).origin;
  if (env.APP_ORIGIN) assert(origin === new URL(env.APP_ORIGIN).origin, 'Wrong host', 403);
  return origin;
}

export async function authChallenge(env: Env, request: Request, kind: string) {
  const id = cookies(request).bh_flow;
  assert(id, 'Start sign-in again');
  const flow = await registry(env, '/challenge/take', { id });
  assert(flow && flow.kind === kind, 'Sign-in expired; start again');
  return flow as Challenge;
}

// Browser-bound, server-side PKCE and pending consent. No ticket is persisted.
export const jlCookie = (id: string, age: number) =>
  `__Host-jl_auth=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;

export function jlTarget(path: string, flags: Record<string, string>) {
  const url = new URL(accountsReturnPath(path), 'https://incord.jesklabs.com');
  for (const [key, value] of Object.entries(flags)) url.searchParams.set(key, value);
  return url.pathname + url.search + url.hash;
}

export function jlRedirect(location: string, id = '', age = 0, sessionCookie?: string) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', jlCookie(id, age));
  if (sessionCookie) headers.append('Set-Cookie', sessionCookie);
  return new Response(null, { status: 302, headers });
}

export async function jesklabsAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    origin = originFor(request, env);
  assert(env.SESSION_SECRET?.length >= 32, 'Service secrets are not configured', 503);
  if (!['GET', 'HEAD'].includes(request.method))
    assert(request.headers.get('Origin') === origin, 'Cross-origin write denied', 403);
  await registry(env, '/limit', {
    key:
      'jl:' +
      (await hmac(env.SESSION_SECRET, authIpBucket(request.headers.get('CF-Connecting-IP')))),
    limit: 60,
    window: 900_000,
  });
  if (path === '/api/auth/jesklabs' && request.method === 'GET') {
    const silent = url.searchParams.get('prompt') === 'none';
    assert(silent || url.searchParams.get('provider') === 'google', 'Choose a sign-in method.');
    assert(!(silent && url.searchParams.get('link') === '1'), 'Choose a sign-in method.');
    const uid =
      url.searchParams.get('link') === '1' ? (await signedIn(request, env)).uid : undefined;
    const id = random(),
      state = random(),
      verifier = random(48),
      returnPath = accountsReturnPath(url.searchParams.get('return'));
    const previous = cookies(request)['__Host-jl_auth'];
    if (previous) await registry(env, '/challenge/take', { id: previous });
    await registry(env, '/challenge/set', {
      id,
      ttl: 600_000,
      value: { kind: 'jl', state, verifier, silent, returnPath, ...(uid ? { uid } : {}) },
    });
    // A non-authorizing return breadcrumb outlives consumed/expired flows so
    // callback retries can still recover MCP and group deep links.
    await registry(env, '/challenge/set', {
      id: 'jl-return:' + state,
      ttl: 1_800_000,
      value: { kind: 'jl-return', returnPath },
    });
    const target = new URL('https://accounts.jesklabs.com/authorize');
    target.search = new URLSearchParams({
      client: 'incord',
      redirect_uri: origin + '/auth/jesklabs/callback',
      state,
      code_challenge: await digest(verifier),
      code_challenge_method: 'S256',
      ...(silent ? { prompt: 'none' } : { provider: 'google' }),
    }).toString();
    return jlRedirect(target.href, id, 600);
  }
  const id = cookies(request)['__Host-jl_auth'];
  if (path === '/auth/jesklabs/callback' && request.method === 'GET') {
    // Take before exchange: state and grant cannot be replayed, including failures.
    let flow: any = null,
      returnPath = '/';
    try {
      flow = id ? await registry(env, '/challenge/take', { id }) : null;
      returnPath = flow?.returnPath || '/';
      const callbackState = url.searchParams.get('state') || '';
      if (!flow && /^[A-Za-z0-9_-]{43}$/.test(callbackState)) {
        const breadcrumb = await registry(env, '/challenge/peek', {
          id: 'jl-return:' + callbackState,
        });
        if (breadcrumb?.kind === 'jl-return') returnPath = breadcrumb.returnPath;
      }
      assert(
        flow?.kind === 'jl' &&
          typeof flow.state === 'string' &&
          constantTimeEqual(flow.state, url.searchParams.get('state') || ''),
        'Sign-in expired. Please start again.',
        401,
      );
      if (flow.uid)
        assert((await signedIn(request, env)).uid === flow.uid, 'Sign-in account changed', 401);
      if (url.searchParams.has('error'))
        return jlRedirect(
          jlTarget(returnPath, {
            jlOptions: '1',
            ...(url.searchParams.get('error') === 'login_required'
              ? {}
              : { jlError: 'Sign-in was not completed. Please try again.' }),
          }),
        );
      const code = url.searchParams.get('code');
      assert(code, 'Sign-in was not completed. Please try again.', 401);
      const identity = await accountsCall(env.ACCOUNTS_SVC, 'exchangeCode', {
        code,
        codeVerifier: flow.verifier,
        redirectUri: origin + '/auth/jesklabs/callback',
      });
      if (flow.silent) {
        const pendingId = random();
        await registry(env, '/challenge/set', {
          id: pendingId,
          value: { kind: 'jl-pending', sub: identity.sub, email: identity.email, returnPath },
        });
        return jlRedirect(jlTarget(returnPath, { jlConfirm: '1' }), pendingId, 300);
      }
      const uid = await resolveAccounts(env, identity, flow.uid);
      const login = await issue(env, uid, origin);
      return jlRedirect(
        jlTarget(returnPath, flow.uid ? { googleLink: 'success' } : { signedIn: '1' }),
        '',
        0,
        login.headers.get('Set-Cookie')!,
      );
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof AccountsError
          ? error.message
          : 'Sign-in is temporarily unavailable. Please try again shortly.';
      return jlRedirect(
        jlTarget(returnPath, {
          jlOptions: '1',
          jlError: message,
          ...(flow?.uid
            ? {
                googleLink:
                  error instanceof ApiError && error.status === 409 ? 'collision' : 'failed',
              }
            : {}),
        }),
      );
    }
  }
  if (path === '/api/auth/jesklabs/pending' && request.method === 'GET') {
    const pending = id ? await registry(env, '/challenge/peek', { id }) : null;
    assert(pending?.kind === 'jl-pending', 'Sign-in expired. Please start again.', 401);
    return json({ email: maskedEmail(pending.email) });
  }
  if (
    (path === '/api/auth/jesklabs/confirm' || path === '/api/auth/jesklabs/cancel') &&
    request.method === 'POST'
  ) {
    await body(request, 1024);
    const pending = id ? await registry(env, '/challenge/take', { id }) : null;
    if (path.endsWith('/cancel')) return json({ ok: true }, 200, { 'Set-Cookie': jlCookie('', 0) });
    assert(pending?.kind === 'jl-pending', 'Sign-in expired. Please start again.', 401);
    const uid = await resolveAccounts(env, {
      sub: pending.sub,
      email: pending.email,
      isNew: false,
    });
    const login = await issue(env, uid, origin, { returnPath: pending.returnPath });
    login.headers.append('Set-Cookie', jlCookie('', 0));
    return login;
  }
  throw new ApiError(404, 'Route not found');
}
