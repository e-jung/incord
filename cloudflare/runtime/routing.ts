import { generateSignInCode, validCode } from '../../shared/sign-in-code';
import { supportUrl } from '../../shared/support';
import { accountsCall } from '../accounts';
import { handleEsv } from '../esv';
import { submitFeedback } from '../feedback';
import { handleGroups } from '../groups';
import { oauthCall } from '../oauth-storage';
import {
  accountsUsers,
  authChallenge,
  authIpBucket,
  cookie,
  cookieName,
  cookies,
  emailEnabled,
  emailKey,
  identityFlags,
  issue,
  jesklabsAuth,
  normalizeEmail,
  originFor,
  resolveAccounts,
  signedIn,
  signInCodeKey,
} from './auth';
import { ApiError, assert, body, digest, hmac, json, random, registry, user } from './common';
import { deleteAccount } from './maintenance';
import { Env, ObjectData, Session } from './types';

/** Telemetry is deliberately lossy: never forward arbitrary exception text or URLs. */
export function clientErrorRecord(input: ObjectData, origin: string) {
  const message = typeof input.message === 'string' ? input.message : '';
  const errorName = new RegExp(
    '^(?:(?:Unhandled |Uncaught (?:\\(in promise\\) )?))?(TypeError|ReferenceError|RangeError|Syn' +
      'taxError|URIError|EvalError|Error|AbortError|NetworkError|QuotaExceededError|InvalidStateE' +
      'rror|SecurityError)(?=:|$)',
    '',
  ).exec(message)?.[1];
  const stack =
    typeof input.stack === 'string'
      ? input.stack
          .split('\n')
          .flatMap((line) => {
            const localFrame = line.match(
              /^\/(?:assets\/[a-zA-Z0-9_.-]+\.(?:js|mjs)|sw\.js):\d+:\d+$/,
            );
            if (localFrame) return [localFrame[0]];
            const match = line.match(/https?:\/\/[^\s)]+/);
            if (!match) return [];
            try {
              const frame = new URL(match[0]);
              if (
                frame.origin !== origin ||
                frame.search ||
                frame.hash ||
                !/^\/(?:assets\/[a-zA-Z0-9_.-]+\.(?:js|mjs)|sw\.js):\d+:\d+$/.test(frame.pathname)
              )
                return [];
              return [frame.pathname];
            } catch {
              return [];
            }
          })
          .slice(0, 5)
          .join('\n')
      : '';
  // Incord is a single-path app. Do not retain arbitrary paths, query strings, or fragments.
  const route =
    typeof input.route === 'string' &&
    /^\/(?:account|today|library|practice|learned|gallery)?(?:[?#].*)?$/.test(input.route)
      ? input.route.split(/[?#]/)[0]
      : '/';
  const version =
    typeof input.version === 'string' &&
    /^(?:[a-f0-9]{7,40}|dev|development|unknown)$/.test(input.version)
      ? input.version
      : 'unknown';
  const uaFamily = ['Safari', 'Chrome', 'Chromium', 'Firefox', 'Edge', 'Other'].includes(
    String(input.uaFamily ?? input.ua),
  )
    ? String(input.uaFamily ?? input.ua)
    : 'Other';
  return {
    message: errorName || 'Client error (message omitted)',
    stack,
    route,
    version,
    uaFamily,
  };
}

export async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    origin = originFor(request, env);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
    assert(request.headers.get('Origin') === origin, 'Cross-origin write denied', 403);
  if (path === '/api/auth/jesklabs' || path.startsWith('/api/auth/jesklabs/')) {
    assert(env.SESSION_SECRET?.length >= 32, 'Service secrets are not configured', 503);
    return jesklabsAuth(request, env);
  }
  if (path === '/api/config' && request.method === 'GET')
    return json({
      donateUrl: supportUrl(env.DONATE_URL),
      email: emailEnabled(env, request),
      google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      googleEnabled:
        env.ACCOUNTS_GOOGLE === '1'
          ? !!env.ACCOUNTS_SVC
          : !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      accountsGoogle: env.ACCOUNTS_GOOGLE === '1',
      push: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
      vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
    });
  if (path === '/api/test/last-code') throw new ApiError(404, 'Not found');
  assert(env.SESSION_SECRET?.length >= 32, 'Service secrets are not configured', 503);

  if (path === '/api/feedback') {
    assert(request.method === 'POST', 'Method not allowed', 405);
    const input = await body(request, 24000);
    let identity: { uid: string } | undefined;
    try {
      identity = await signedIn(request, env);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    return json(await submitFeedback(request, env, input, identity));
  }
  if (path === '/api/log' && request.method === 'POST') {
    await registry(env, '/limit', {
      key:
        'log:' +
        (await digest(
          env.SESSION_SECRET + ':' + (request.headers.get('CF-Connecting-IP') || 'local'),
        )),
      limit: 10,
      window: 60_000,
    });
    const input = await body(request, 2048);
    console.log(JSON.stringify({ evt: 'client_error', ...clientErrorRecord(input, origin) }));
    return json({ ok: true });
  }
  if (path === '/api/esv')
    return handleEsv(request, env, {
      signedIn: async () => {
        try {
          await signedIn(request, env);
          return true;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) return false;
          throw error;
        }
      },
      anonymousAllowed: async (limit, windowSeconds) => {
        try {
          await registry(env, '/limit', {
            key:
              'esv:' +
              (await digest(
                env.SESSION_SECRET + ':' + (request.headers.get('CF-Connecting-IP') || 'local'),
              )),
            limit,
            window: windowSeconds * 1000,
          });
          return true;
        } catch (error) {
          if (error instanceof ApiError && error.status === 429) return false;
          throw error;
        }
      },
    });
  if (path.startsWith('/api/auth/')) {
    try {
      await registry(env, '/limit', {
        key: await digest(
          env.SESSION_SECRET + ':' + authIpBucket(request.headers.get('CF-Connecting-IP')),
        ),
        limit: 60,
        window: 900_000,
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 429 &&
        ['/api/auth/code/create', '/api/auth/code/signin'].includes(path)
      )
        throw new ApiError(429, 'Unable to sign in with that code. Check it or try again later.');
      throw error;
    }
    if (path.startsWith('/api/auth/code/') && request.method === 'POST') {
      const input = await body(request, 2048);
      const ip = await hmac(
        env.SESSION_SECRET,
        'signin-code-ip:' + authIpBucket(request.headers.get('CF-Connecting-IP')),
      );
      if (path.endsWith('/create') || path.endsWith('/signin')) {
        // Code-specific failures share one generic response, including rate failures.
        try {
          await registry(env, '/limit', { key: 'code-ip:' + ip, limit: 10, window: 900_000 });
        } catch (error) {
          if (error instanceof ApiError && error.status === 429)
            throw new ApiError(
              429,
              'Unable to sign in with that code. Check it or try again later.',
            );
          throw error;
        }
      }
      if (path === '/api/auth/code/signin') {
        const result = await registry(env, '/code/signin', {
          key: await signInCodeKey(env, input.code),
          valid: validCode(input.code),
        });
        await user(env, result.uid, '/init', { name: 'Friend' });
        return issue(env, result.uid, origin);
      }
      if (path === '/api/auth/code/create' || path === '/api/auth/code/regenerate') {
        let uid: string;
        if (path.endsWith('/create')) {
          let existing = false;
          try {
            await signedIn(request, env);
            existing = true;
          } catch (error) {
            if (!(error instanceof ApiError && error.status === 401)) throw error;
          }
          assert(!existing, 'Sign out before creating another account.', 409);
          try {
            await registry(env, '/limit', {
              key: 'code-global-create',
              limit: 1000,
              window: 900_000,
            });
          } catch (error) {
            if (error instanceof ApiError && error.status === 429)
              throw new ApiError(
                429,
                'Unable to sign in with that code. Check it or try again later.',
              );
            throw error;
          }
          uid = crypto.randomUUID();
        } else uid = (await signedIn(request, env)).uid;
        // Collisions are astronomically unlikely; never replace somebody else's mapping.
        let code = '';
        for (let attempt = 0; attempt < 5; attempt++) {
          code = generateSignInCode();
          const result = await registry(env, '/code/set', {
            uid,
            key: await signInCodeKey(env, code),
            revision: crypto.randomUUID(),
          });
          if (result.ok) break;
          code = '';
        }
        assert(code, 'Unable to create a code. Try again.', 503);
        await user(env, uid, '/init', { name: 'Friend' });
        return issue(env, uid, origin, { code });
      }
      if (path === '/api/auth/code/remove') {
        const session = await signedIn(request, env);
        await registry(env, '/code/remove', { uid: session.uid });
        return issue(env, session.uid, origin);
      }
      throw new ApiError(404, 'Route not found');
    }
    if (
      (path === '/api/auth/email/start' || path === '/api/auth/email/verify') &&
      request.method === 'POST'
    ) {
      assert(emailEnabled(env, request), 'Email sign-in is not enabled.', 404);
      const input = await body(request, 2048),
        email = normalizeEmail(input.email);
      const linkUid = input.link === true ? (await signedIn(request, env)).uid : undefined;
      const ip = request.headers.get('CF-Connecting-IP') || '';
      if (path.endsWith('/start')) {
        await accountsCall(env.ACCOUNTS_SVC, 'startEmail', { email, ip });
        return json({ ok: true, message: 'Check your email for a six-digit code.' });
      }
      assert(
        typeof input.code === 'string' && /^\d{6}$/.test(input.code),
        'Enter the six-digit code.',
      );
      const result = await accountsCall(env.ACCOUNTS_SVC, 'verifyEmail', {
        email,
        code: input.code,
        ip,
      });
      const uid = await resolveAccounts(env, result, linkUid);
      return issue(env, uid, origin, { ssoTicket: result.ssoTicket });
    }

    if (path === '/api/auth/logout-everywhere' && request.method === 'POST') {
      const session = await signedIn(request, env);
      await user(env, session.uid, '/revoke');
      assert(
        (await oauthCall(env, '/revoke-all', { origin, uid: session.uid })).ok,
        'Unable to disconnect apps. Please try again.',
        503,
      );
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(cookieName, '', 0, origin) });
    }
    if (path === '/api/auth/logout' && request.method === 'POST')
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(cookieName, '', 0, origin) });
    if (path === '/api/auth/google' && request.method === 'GET') {
      assert(
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
        'Google sign-in is not enabled',
        404,
      );
      const state = random(),
        verifier = random(48),
        uid = url.searchParams.get('link') === '1' ? (await signedIn(request, env)).uid : undefined;
      await registry(env, '/challenge/set', {
        id: state,
        value: { kind: 'google', challenge: state, verifier, ...(uid ? { uid } : {}) },
      });
      const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      target.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: origin + '/api/auth/google/callback',
        response_type: 'code',
        scope: 'openid profile email',
        state,
        code_challenge: await digest(verifier),
        code_challenge_method: 'S256',
      }).toString();
      return new Response(null, {
        status: 302,
        headers: {
          Location: target.href,
          'Set-Cookie': cookie('bh_flow', state, 300, origin),
          'Cache-Control': 'no-store',
        },
      });
    }
    if (path === '/api/auth/google/callback' && request.method === 'GET') {
      assert(
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
        'Google sign-in is not enabled',
        404,
      );
      assert(url.searchParams.get('state') === cookies(request).bh_flow, 'Invalid OAuth state');
      const flow = await authChallenge(env, request, 'google');
      try {
        const code = url.searchParams.get('code');
        assert(code, 'Google sign-in cancelled');
        const tokens = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            code,
            code_verifier: flow.verifier!,
            grant_type: 'authorization_code',
            redirect_uri: origin + '/api/auth/google/callback',
          }),
        });
        assert(tokens.ok, 'Google sign-in failed', 401);
        const token = await tokens.json<{ access_token: string }>();
        const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: 'Bearer ' + token.access_token },
        });
        assert(profileResponse.ok, 'Google sign-in failed', 401);
        const profile = await profileResponse.json<{
          sub: string;
          name?: string;
          email?: string;
          email_verified?: boolean;
          hd?: string;
        }>();
        assert(profile.sub, 'Google profile missing', 401);
        // Google is authoritative only for Gmail or verified Workspace addresses.
        // Other verified addresses may have changed owners since Google verified them.
        const verifiedEmail =
          profile.email_verified === true && profile.email
            ? normalizeEmail(profile.email)
            : undefined;
        const authoritativeEmail =
          verifiedEmail &&
          (verifiedEmail.endsWith('@gmail.com') ||
            (profile.hd && verifiedEmail.endsWith('@' + profile.hd.toLowerCase())));
        if (flow.uid)
          assert((await signedIn(request, env)).uid === flow.uid, 'Sign-in account changed', 401);
        const mapping = await registry(env, '/google', {
          sub: profile.sub,
          ...(flow.uid ? { uid: flow.uid } : {}),
          ...(authoritativeEmail ? { emailKey: await emailKey(env, verifiedEmail!) } : {}),
        });
        await user(env, mapping.uid, '/init', { name: profile.name || 'Friend' });
        // Best effort convergence; infrastructure failure must not block old Google.
        try {
          const imported = await accountsCall(env.ACCOUNTS_SVC, 'importIdentity', {
            googleSub: profile.sub,
            verifiedAt: Date.now(),
          });
          await registry(env, '/jl/resolve', { sub: imported.sub, uid: mapping.uid });
        } catch {
          console.log(JSON.stringify({ evt: 'accounts_legacy_import_failed', count: 1 }));
        }
        const login = await issue(env, mapping.uid, origin);
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/?signedIn=1',
            'Set-Cookie': login.headers.get('Set-Cookie')!,
            'Cache-Control': 'no-store',
          },
        });
      } catch (error) {
        if (!flow.uid || !(error instanceof ApiError)) throw error;
        const result =
          error.status === 409 ? 'collision' : error.status === 401 ? 'expired' : 'failed';
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/?googleLink=' + result,
            'Set-Cookie': cookie('bh_flow', '', 0, origin),
            'Cache-Control': 'no-store',
          },
        });
      }
    }
    throw new ApiError(404, 'Route not found');
  }
  let session: Session;
  try {
    session = await signedIn(request, env);
  } catch (error) {
    if (
      path === '/api/me' &&
      request.method === 'GET' &&
      error instanceof ApiError &&
      error.status === 401
    )
      return json({
        user: null,
        ...(error.message === 'Session expired' ? { signedOutEverywhere: true } : {}),
      });
    throw error;
  }
  const uid = session.uid;
  if (path === '/api/oauth/consent') {
    if (request.method === 'GET')
      return oauthCall(env, '/consent', {
        origin,
        url: origin + '/oauth/authorize' + url.search,
        headers: [...request.headers],
        uid,
        version: session.version,
      });
    if (request.method === 'POST') {
      const input = await body(request, 4096);
      assert(typeof input.handle === 'string' && input.handle.length <= 1024, 'Invalid consent');
      return oauthCall(env, '/decision', {
        origin,
        url: origin + '/oauth/authorize',
        method: 'POST',
        headers: [...request.headers],
        handle: input.handle,
        decision: input.decision,
        uid,
        version: session.version,
        statsEnabled:
          input.statsEnabled === true &&
          request.headers.get('DNT') !== '1' &&
          request.headers.get('Sec-GPC') !== '1',
      });
    }
  }
  if (path === '/api/oauth/privacy' && request.method === 'POST') {
    const input = await body(request, 1024);
    assert(typeof input.enabled === 'boolean', 'Invalid privacy preference');
    return json(await user(env, uid, '/mcp/privacy', { enabled: input.enabled }));
  }
  if (path === '/api/groups' || path.startsWith('/api/groups/'))
    return handleGroups(
      request,
      env,
      uid,
      ['POST'].includes(request.method) ? await body(request, 4096) : {},
    );
  if (path === '/api/oauth/apps' && request.method === 'GET')
    return oauthCall(env, '/apps', { origin, uid });
  if (path === '/api/oauth/revoke' && request.method === 'POST') {
    const input = await body(request, 4096);
    assert(typeof input.id === 'string' && input.id.length <= 200, 'Invalid connected app');
    return oauthCall(env, '/revoke', { origin, uid, id: input.id });
  }
  if (path === '/api/me' && request.method === 'GET') {
    const me = await user(env, uid, '/me'),
      flags = await identityFlags(env, uid);
    return json({ user: { ...me.user, ...flags } });
  }
  if (path === '/api/sync' && request.method === 'POST') {
    const input = await body(request);
    const result = await user(env, uid, '/sync', input);
    await registry(env, '/schedule/set', { uid });
    return json(result);
  }
  if (path === '/api/export' && request.method === 'GET')
    return json(
      { ...(await user(env, uid, '/export')), jesklabsAccounts: await accountsUsers(env, uid) },
      200,
      { 'Content-Disposition': 'attachment; filename="incord.json"' },
    );
  if (path === '/api/account' && request.method === 'DELETE') {
    await deleteAccount(env, uid, origin);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(cookieName, '', 0, origin) });
  }
  if (path === '/api/push/subscribe' && request.method === 'POST') {
    const input = await body(request);
    assert(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY, 'Push is not configured', 503);
    const result = await user(env, uid, '/push/subscribe', { ...input, origin });
    await registry(env, '/schedule/set', { uid });
    return json(result);
  }
  if (path === '/api/push/status' && request.method === 'GET') {
    const endpointHash = url.searchParams.get('endpointHash');
    assert(endpointHash === null || /^[a-f0-9]{64}$/.test(endpointHash), 'Invalid endpoint hash');
    return json(await user(env, uid, '/push/status', { endpointHash, origin }));
  }
  if (path === '/api/push/test' && request.method === 'POST') {
    await registry(env, '/limit', { key: 'push:' + uid, limit: 3, window: 60_000 });
    return json(await user(env, uid, '/push/test'));
  }
  throw new ApiError(404, 'Route not found');
}
