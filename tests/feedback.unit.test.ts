import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker, { RegistryDO, signSession, type Env } from '../cloudflare/worker';
import { submitFeedback, validateFeedback } from '../cloudflare/feedback';
const input = { kind: 'Idea', message: 'Please add a new feature' };
function fixture() {
  const db = new DatabaseSync(':memory:');
  const state = {
    storage: {
      sql: {
        exec(q: string, ...args: any[]) {
          const s = db.prepare(q);
          return s.columns().length ? s.all(...args) : (s.run(...args), []);
        },
      },
      transactionSync(fn: () => unknown) {
        db.exec('BEGIN');
        try {
          const r = fn();
          db.exec('COMMIT');
          return r;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
    blockConcurrencyWhile: (fn: () => unknown) => fn(),
  } as unknown as DurableObjectState;
  const registry = new RegistryDO(state),
    env = { SESSION_SECRET: 'feedback-unit-secret-longer-than-32-chars' } as Env;
  env.REGISTRY = {
    idFromName: () => '',
    get: () => ({
      fetch: (url: string, init: RequestInit) => registry.fetch(new Request(url, init)),
    }),
  } as unknown as DurableObjectNamespace;
  const req = (ip = '192.0.2.1', host = 'app.test') =>
    new Request('https://' + host + '/api/feedback', { headers: { 'CF-Connecting-IP': ip } });
  const send = (
    value: unknown = input,
    ip = '192.0.2.1',
    identity?: { uid: string; clientName?: string },
    source: 'app' | 'mcp' = 'app',
  ) => submitFeedback(req(ip), env, value, identity, source);
  const rows = () => db.prepare('SELECT * FROM feedback ORDER BY rowid').all() as any[];
  const internal = (path: string, data: unknown = {}) =>
    registry.fetch(
      new Request('https://registry' + path, { method: 'POST', body: JSON.stringify(data) }),
    );
  return { db, state, registry, env, req, send, rows, internal };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('Feedback boundary', () => {
  it('trims messages/contact, permits blank contact and accepts only bounded structured metadata', () => {
    expect(
      validateFeedback({ ...input, message: '  ' + input.message + '  ', contact: '  ' }),
    ).toEqual(input);
    expect(
      validateFeedback({
        ...input,
        contact: ' person@example.com ',
        meta: {
          version: 'abcdef1',
          platform: 'iOS',
          uaFamily: 'Safari',
          viewport: { width: 390, height: 844 },
          signedIn: false,
        },
      }),
    ).toMatchObject({ contact: 'person@example.com' });
    expect(validateFeedback({ ...input, message: 'a'.repeat(4000) }).message).toHaveLength(4000);
  });
  it.each([
    null,
    [],
    { ...input, kind: 'Bug' },
    { ...input, kind: { toString: 'broken' } },
    { ...input, message: ' short ' },
    { ...input, message: 'a'.repeat(4001) },
    { ...input, uid: 'secret' },
    { ...input, contact: 'invalid' },
    { ...input, contact: 'a@example.com\nBcc: other@example.com' },
    { ...input, meta: { token: 'secret' } },
    { ...input, meta: { version: 'secret-token' } },
    { ...input, meta: { platform: 'arbitrary text' } },
    { ...input, meta: { platform: ['iOS'] } },
    { ...input, meta: { uaFamily: 'full private UA' } },
    { ...input, meta: { signedIn: 'yes' } },
    { ...input, meta: { viewport: { width: 0, height: 100 } } },
    { ...input, meta: { viewport: { width: 400, height: 100, secret: 'x' } } },
  ])('rejects unsafe input %#', (value) => expect(() => validateFeedback(value)).toThrow());
  it('stores anonymous feedback without sending when mail is absent, and never stores raw network/account identifiers', async () => {
    const f = fixture(),
      fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(
      await f.send(
        { ...input, meta: { signedIn: false } },
        '203.0.113.71',
        { uid: 'raw-private-account', clientName: 'Desktop' },
        'mcp',
      ),
    ).toEqual({ ok: true, message: 'Thanks — Eric reads every one.' });
    expect(f.rows()[0]).toMatchObject({
      kind: 'Idea',
      source: 'mcp',
      clientName: 'Desktop',
      contact: null,
    });
    expect(f.rows()[0].accountRef).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.parse(f.rows()[0].meta).signedIn).toBe(true);
    const stored = JSON.stringify([f.rows(), f.db.prepare('SELECT * FROM feedback_limits').all()]);
    expect(stored).not.toContain('raw-private-account');
    expect(stored).not.toContain('203.0.113.71');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports numeric 503 configuration/storage failures before durable success', async () => {
    const f = fixture();
    await expect(
      submitFeedback(f.req(), { ...f.env, SESSION_SECRET: '' }, input),
    ).rejects.toMatchObject({ status: 503 });
    f.env.REGISTRY = {
      idFromName: () => '',
      get: () => ({ fetch: async () => new Response('{}', { status: 500 }) }),
    } as unknown as DurableObjectNamespace;
    await expect(f.send()).rejects.toMatchObject({ status: 503 });
  });
  it('shares persistent per-IP limits across app/MCP and resets after an hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const f = fixture();
    for (let i = 0; i < 5; i++) await f.send(input, undefined, undefined, i % 2 ? 'mcp' : 'app');
    await expect(f.send()).rejects.toMatchObject({ status: 429 });
    expect(f.rows()).toHaveLength(5);
    // Re-create the DO over the same persisted state.
    const again = new RegistryDO(f.state);
    f.env.REGISTRY.get = (() => ({
      fetch: (url: string, init: RequestInit) => again.fetch(new Request(url, init)),
    })) as any;
    await expect(f.send()).rejects.toMatchObject({ status: 429 });
    vi.advanceTimersByTime(3600000);
    await f.send();
    expect(f.rows()).toHaveLength(6);
  });
  it('enforces the independent authenticated-user daily quota across IPs and rolls at UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T23:59:00Z'));
    const f = fixture();
    for (let i = 0; i < 10; i++) await f.send(input, 'ip-' + i, { uid: 'same-account' });
    await expect(f.send(input, 'fresh-ip', { uid: 'same-account' })).rejects.toMatchObject({
      status: 429,
    });
    // A user rejection must not consume the fresh IP quota.
    for (let i = 0; i < 5; i++) await f.send(input, 'fresh-ip');
    vi.advanceTimersByTime(60000);
    await f.send(input, 'new-ip', { uid: 'same-account' });
  });
  it('keeps the localhost sink network-free even with a real-looking key, but never activates it on remote hosts', async () => {
    const f = fixture();
    f.env.EMAIL_TEST_SINK = '1';
    f.env.RESEND_API_KEY = 'not-a-live-key';
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await submitFeedback(f.req('a', 'localhost'), f.env, input);
    expect(fetch).not.toHaveBeenCalled();
    expect(f.rows()[0].emailed).toBe(1);
    await f.send(input, 'b');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('sends safe subjects to support with explicit reply-to only, and a short keyed reference instead of UID', async () => {
    const f = fixture();
    f.env.RESEND_API_KEY = 'unit-key';
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await f.send(
      {
        ...input,
        message: 'A feature\nwith a newline\u0000 and more text',
        contact: ' person@example.com ',
      },
      undefined,
      { uid: 'raw-private-id', clientName: 'Desktop\nclient' },
    );
    const p = JSON.parse(fetch.mock.calls[0][1].body);
    expect(p).toMatchObject({
      to: 'incord@jesklabs.com',
      from: 'Incord <hello@jesklabs.com>',
      reply_to: 'person@example.com',
    });
    expect(p.subject).not.toMatch(/[\r\n\x00]/);
    expect(p.text).not.toContain('raw-private-id');
    await f.send(input, 'other');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('reply_to');
    expect(fetch.mock.calls[0][1].redirect).toBe('manual');
  });
  it('reserves the hard 30/day budget before network, stores overcap feedback, and carries the summary across midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const f = fixture();
    f.env.RESEND_API_KEY = 'unit-key';
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    for (let i = 0; i < 33; i++) await f.send(input, 'ip-' + i);
    expect(fetch).toHaveBeenCalledTimes(30);
    expect(f.rows()).toHaveLength(33);
    expect(f.db.prepare('SELECT count FROM feedback_email_budget').get()).toMatchObject({
      count: 30,
    });
    vi.setSystemTime(new Date('2026-11-14T00:00:00Z'));
    await f.send(input, 'new');
    expect(fetch).toHaveBeenCalledTimes(31);
    expect(JSON.parse(fetch.mock.calls[30][1].body).text).toContain('3 more stored');
    expect(f.rows().every((r) => r.emailed === 1)).toBe(true);
  });
  it('returns durable success on provider failure and preserves the summary until an actual success', async () => {
    const f = fixture();
    f.env.RESEND_API_KEY = 'unit-key';
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('private provider secret'))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    expect((await f.send()).ok).toBe(true);
    expect((await f.send(input, 'b')).ok).toBe(true);
    expect(f.rows().every((r) => r.emailed === 0)).toBe(true);
    await f.send(input, 'c');
    expect(JSON.parse(fetch.mock.calls[2][1].body).text).toContain('2 more stored');
    expect(f.rows().every((r) => r.emailed === 1)).toBe(true);
    expect(f.db.prepare('SELECT count FROM feedback_email_budget').get()).toMatchObject({
      count: 3,
    });
  });
  it('notifies concurrent submissions independently and does not acknowledge another failed notification', async () => {
    const f = fixture();
    f.env.RESEND_API_KEY = 'unit-key';
    let complete!: (r: Response) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const first = f.send();
    while (!complete) await new Promise((resolve) => setTimeout(resolve, 0));
    await f.send(input, 'b');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(f.rows().map((r) => r.emailed)).toEqual([0, 1]);
    complete(new Response('', { status: 500 }));
    await first;
    expect(f.rows().map((r) => r.emailed)).toEqual([0, 1]);
    await f.send(input, 'c');
    expect(JSON.parse(fetch.mock.calls[2][1].body).text).toContain('1 more stored');
    expect(f.rows().every((r) => r.emailed === 1)).toBe(true);
  });
  it('reserves at most thirty notifications under concurrent load', async () => {
    const f = fixture();
    f.env.RESEND_API_KEY = 'unit-key';
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await Promise.all(Array.from({ length: 35 }, (_, i) => f.send(input, 'concurrent-' + i)));
    expect(fetch).toHaveBeenCalledTimes(30);
    expect(f.rows()).toHaveLength(35);
    expect(f.rows().filter((r) => r.emailed === 0)).toHaveLength(5);
  });
  it('recovers an expired notification lease into the next summary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const f = fixture();
    await f.internal('/feedback/submit', {
      row: { id: 'interrupted', at: Date.now(), ...input, source: 'app' },
      ip: 'old',
      email: true,
    });
    vi.advanceTimersByTime(60001);
    f.env.RESEND_API_KEY = 'unit-key';
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await f.send(input, 'next');
    expect(JSON.parse(fetch.mock.calls[0][1].body).text).toContain('1 more stored');
    expect(f.rows().every((r) => r.emailed === 1)).toBe(true);
  });
  it('bounds the private report to 100 newest rows, including tied timestamps', async () => {
    const f = fixture();
    for (let i = 0; i < 103; i++)
      await f.send({ ...input, message: 'Feedback item ' + i }, 'ip-' + i);
    const report = await (await f.internal('/feedback/list')).json<any>();
    expect(report.feedback).toHaveLength(100);
    expect(report.feedback[0].message).toBe('Feedback item 102');
    expect(report.feedback.at(-1).message).toBe('Feedback item 3');
  });
  it('exposes POST to signed-out and signed-in users with same-origin, size, type and validation checks', async () => {
    const f = fixture();
    const call = (data: unknown, extra: Record<string, string> = {}, method = 'POST') =>
      worker.fetch(
        new Request('https://app.test/api/feedback', {
          method,
          headers: { Origin: 'https://app.test', 'Content-Type': 'application/json', ...extra },
          ...(method === 'POST' ? { body: JSON.stringify(data) } : {}),
        }),
        f.env,
        {} as ExecutionContext,
      );
    expect((await call(input)).status).toBe(200);
    expect((await call(input, { Origin: 'https://evil.test' })).status).toBe(403);
    expect((await call(input, {}, 'GET')).status).toBe(405);
    expect((await call(input, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await call({ ...input, message: 'a'.repeat(25000) })).status).toBe(413);
    expect((await call({ ...input, message: 'tiny' })).status).toBe(400);
    const uid = crypto.randomUUID();
    f.env.USERS = {
      idFromName: () => '',
      get: () => ({ fetch: async () => Response.json({ version: 0 }) }),
    } as unknown as DurableObjectNamespace;
    const cookie =
      'bh_session=' +
      (await signSession({ uid, version: 0, exp: Date.now() / 1000 + 1000 }, f.env.SESSION_SECRET));
    expect((await call(input, { Cookie: cookie })).status).toBe(200);
    expect(f.rows().at(-1).accountRef).toMatch(/^[a-f0-9]{16}$/);
  });
});
