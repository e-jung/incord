import { deployment } from '../deployment';
import { dispatchGroupReminders, scheduleGroups } from '../groups';
import { ApiError, assert, b64, encoder, registry, unb64 } from './common';
import { Env } from './types';

export type PushResult = { time: number; host: string; status: number; reason: string };

export async function endpointHash(endpoint: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(endpoint)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function pushReason(response: Response, sub: PushSubscriptionData, env: Env) {
  // Bound the read even if a provider returns an unexpectedly large response.
  const reader = response.body?.getReader();
  if (!reader) return '';
  let value = '';
  try {
    const decoder = new TextDecoder();
    while (value.length < 4096) {
      const part = await reader.read();
      if (part.done) break;
      value += decoder.decode(part.value.subarray(0, 4096), { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  for (const secret of [
    sub.endpoint,
    sub.keys.auth,
    sub.keys.p256dh,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  ])
    if (secret) value = value.split(secret).join('[redacted]');
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/https?:\/\/[^\s"<>]+/g, '[url]')
    .slice(0, 200);
}

export type PushSubscriptionData = { endpoint: string; keys: { p256dh: string; auth: string } };

export function validateSubscription(sub: PushSubscriptionData) {
  assert(
    sub && typeof sub.endpoint === 'string' && sub.endpoint.length < 2048 && sub.keys,
    'Invalid push subscription',
  );
  let endpoint: URL;
  try {
    endpoint = new URL(sub.endpoint);
  } catch {
    throw new ApiError(400, 'Invalid push endpoint');
  }
  const host = endpoint.hostname;
  assert(
    endpoint.protocol === 'https:' &&
      !endpoint.username &&
      !endpoint.password &&
      (!endpoint.port || endpoint.port === '443') &&
      (host === 'fcm.googleapis.com' ||
        host === 'android.googleapis.com' ||
        host === 'updates.push.services.mozilla.com' ||
        host.endsWith('.push.services.mozilla.com') ||
        host.endsWith('.push.apple.com') ||
        host.endsWith('.notify.windows.com')),
    'Unsupported push service',
  );
  try {
    assert(
      unb64(sub.keys.p256dh).length === 65 && unb64(sub.keys.auth).length === 16,
      'Invalid subscription keys',
    );
  } catch {
    throw new ApiError(400, 'Invalid subscription keys');
  }
}

export function concat(...parts: Uint8Array[]) {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

export async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8),
  );
}

export async function sendWebPush(
  subscription: PushSubscriptionData,
  payload: unknown,
  env: Env,
): Promise<Response> {
  validateSubscription(subscription);
  const uaPublic = unb64(subscription.keys.p256dh),
    auth = unb64(subscription.keys.auth);
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
  );
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      pair.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(
      auth,
      shared,
      concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic),
      32,
    ),
    salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16),
    nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const clear = concat(encoder.encode(JSON.stringify(payload)), new Uint8Array([2]));
  assert(clear.length < 3993, 'Push payload too large');
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, clear),
  );
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  const vapid = unb64(env.VAPID_PUBLIC_KEY!);
  assert(vapid.length === 65, 'Invalid VAPID public key', 503);
  const signingKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64(vapid.slice(1, 33)),
      y: b64(vapid.slice(33)),
      d: env.VAPID_PRIVATE_KEY!,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const subject = deployment(env).vapidSubject;
  assert(
    /^(?:mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject),
    'Invalid VAPID subject',
    503,
  );
  const unsigned =
    b64(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) +
    '.' +
    b64(
      encoder.encode(
        JSON.stringify({
          aud: new URL(subscription.endpoint).origin,
          exp: Math.floor(Date.now() / 1000) + 1800,
          sub: subject,
        }),
      ),
    );
  const signature = b64(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        signingKey,
        encoder.encode(unsigned),
      ),
    ),
  );
  // Workers do not support redirect: error. Manual refuses forwarding VAPID credentials; 3xx is a delivery failure.
  return fetch(subscription.endpoint, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    headers: {
      TTL: '3600',
      Urgency: 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${unsigned}.${signature}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body: concat(header, asPublic, cipher),
  });
}

export async function scheduleReminders(
  _event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
) {
  ctx.waitUntil(
    (async () => {
      try {
        const { users } = await registry(env, '/schedule/due');
        const results = await Promise.allSettled([
          scheduleGroups(env),
          dispatchGroupReminders(env, users),
        ]);
        if (results.some((r) => r.status === 'rejected'))
          throw new Error('One or more reminder checks failed');
      } catch {
        const requestId = crypto.randomUUID();
        console.log(
          JSON.stringify({
            evt: 'server_error',
            requestId,
            status: 500,
            unexpected: true,
            source: 'scheduled',
          }),
        );
        throw new Error('Reminder checks failed; request ' + requestId);
      }
    })(),
  );
}
