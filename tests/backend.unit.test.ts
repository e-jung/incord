import { afterEach, describe, expect, it, vi } from 'vitest';
import { b64, unb64, signSession, readSession, localDay, timestamp, validateSubscription, sendWebPush, type Env } from '../cloudflare/worker';
const enc = new TextEncoder();
const bytes = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
};
afterEach(() => vi.unstubAllGlobals());

describe('Backend security and interoperable Web Push', () => {
  it('round-trips base64url without padding', () => { const value = crypto.getRandomValues(new Uint8Array(100)); expect(unb64(b64(value))).toEqual(value); });
  it('rejects forged, expired and malformed HMAC sessions', async () => {
    const secret = 'test-only-secret-that-is-over-32-characters';
    const session = { uid: '11111111-1111-4111-8111-111111111111', version: 2, exp: Date.now() / 1000 + 1000 };
    const token = await signSession(session, secret); expect(await readSession(token, secret)).toEqual(session);
    expect(await readSession(token, 'different-key')).toBeNull(); expect(await readSession('bad.token', secret)).toBeNull();
    expect(await readSession(await signSession({ ...session, exp: 1 }, secret), secret)).toBeNull();
  });
  it('computes local dates across UTC boundaries and DST', () => {
    expect(localDay(new Date('2026-11-01T06:30:00Z'), 'America/Los_Angeles')).toBe('2026-10-31');
    expect(localDay(new Date('2026-11-01T09:30:00Z'), 'America/Los_Angeles')).toBe('2026-11-01');
    expect(localDay(new Date('2026-01-01T20:00:00Z'), 'Asia/Tokyo')).toBe('2026-01-02');
  });
  it('validates timestamps and rejects invalid future writes', () => {
    const now = Date.now(); expect(timestamp(now)).toBe(now); expect(timestamp(new Date(now).toISOString())).toBe(now);
    for (const value of [NaN, -1, 'nonsense', now + 86400000, undefined]) expect(() => timestamp(value)).toThrow();
  });
  it('prevents push endpoint SSRF and malformed key material', () => {
    const keys = { p256dh: b64(new Uint8Array(65)), auth: b64(new Uint8Array(16)) };
    for (const endpoint of ['http://fcm.googleapis.com/a', 'https://127.0.0.1/a', 'https://fcm.googleapis.com.evil.test/a', 'https://fcm.googleapis.com:8443/a', 'https://user:password@fcm.googleapis.com/a']) expect(() => validateSubscription({ endpoint, keys })).toThrow();
    expect(() => validateSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys })).not.toThrow();
  });
  it('encrypts decryptable RFC8291 records and signs a verifiable audience-scoped VAPID JWT', async () => {
    const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const receiverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey));
    const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey)); const privateJwk = await crypto.subtle.exportKey('jwk', vapid.privateKey);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const env = { VAPID_PUBLIC_KEY: b64(publicRaw), VAPID_PRIVATE_KEY: privateJwk.d!, VAPID_SUBJECT: 'mailto:test@example.com' } as Env;
    const payload = { title: 'By Heart', body: 'A gentle moment', url: '/' };
    let init: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => { init = options; return new Response(null, { status: 201 }); }));
    const response = await sendWebPush({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: b64(receiverPublic), auth: b64(auth) } }, payload, env);
    expect(response.status).toBe(201); expect(init!.redirect).toBe('error');
    const record = init!.body as Uint8Array; const salt = record.slice(0, 16); expect(new DataView(record.buffer).getUint32(16)).toBe(4096); expect(record[20]).toBe(65);
    const senderPublic = record.slice(21, 86); const senderKey = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, receiver.privateKey, 256));
    const ikm = await hkdf(auth, shared, bytes(enc.encode('WebPush: info\0'), receiverPublic, senderPublic), 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16); const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']); const clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, record.slice(86)));
    expect(clear.at(-1)).toBe(2); expect(JSON.parse(new TextDecoder().decode(clear.slice(0, -1)))).toEqual(payload);
    const headers = new Headers(init!.headers); const authorization = headers.get('Authorization')!; const jwt = authorization.match(/^vapid t=([^,]+), k=/)![1]; const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(unb64(claims)))).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:test@example.com' });
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.publicKey, unb64(signature), enc.encode(header + '.' + claims))).toBe(true);
  });
});
