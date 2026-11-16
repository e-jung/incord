import type { Env } from './worker';

export class FeedbackError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (message = 'Invalid feedback'): never => {
  throw new FeedbackError(400, message);
};
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
};
const keys = (v: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(v).some((k) => !allowed.includes(k))) fail('Unsupported feedback field');
};
export type FeedbackInput = {
  kind: 'Idea' | 'Problem' | 'Other';
  message: string;
  contact?: string;
  meta?: Record<string, unknown>;
};
export type FeedbackRow = FeedbackInput & {
  id: string;
  at: number;
  source: 'app' | 'mcp';
  clientName?: string;
  accountRef?: string;
};
export function validateFeedback(value: unknown): FeedbackInput {
  const v = record(value);
  keys(v, ['kind', 'message', 'contact', 'meta']);
  if (
    typeof v.kind !== 'string' ||
    !['Idea', 'Problem', 'Other'].includes(v.kind) ||
    typeof v.message !== 'string'
  )
    return fail();
  const message = v.message.trim();
  if (message.length < 10 || message.length > 4000) fail('Message must be 10–4000 characters');
  if (v.contact !== undefined && typeof v.contact !== 'string') fail('Invalid contact email');
  const contact = (v.contact as string | undefined)?.trim() || '';
  if (
    contact &&
    (contact.length > 254 ||
      !/^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(contact) ||
      /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(contact))
  )
    fail('Invalid contact email');
  let meta: Record<string, unknown> | undefined;
  if (v.meta !== undefined) {
    const m = record(v.meta);
    keys(m, ['version', 'platform', 'uaFamily', 'viewport', 'signedIn']);
    meta = {};
    for (const name of ['version', 'platform', 'uaFamily'] as const) {
      if (m[name] === undefined) continue;
      const x = m[name];
      if (typeof x !== 'string') fail('Invalid feedback metadata');
      const valid =
        name === 'version'
          ? typeof x === 'string' &&
            /^(?:[a-f0-9]{7,40}|dev|development|unknown|\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(x)
          : name === 'platform'
            ? ['iOS', 'Android', 'macOS', 'Windows', 'Linux', 'Other', 'unknown'].includes(
                String(x),
              )
            : ['Safari', 'Chrome', 'Chromium', 'Firefox', 'Edge', 'Other', 'unknown'].includes(
                String(x),
              );
      if (typeof x !== 'string' || !valid) fail('Invalid feedback metadata');
      meta[name] = x;
    }
    if (m.signedIn !== undefined) {
      if (typeof m.signedIn !== 'boolean') fail();
      meta.signedIn = m.signedIn;
    }
    if (m.viewport !== undefined) {
      const p = record(m.viewport);
      keys(p, ['width', 'height']);
      if (
        ![p.width, p.height].every(
          (x) => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 16384,
        )
      )
        fail('Invalid viewport');
      meta.viewport = { width: p.width, height: p.height };
    }
  }
  return {
    kind: v.kind as FeedbackInput['kind'],
    message,
    ...(contact ? { contact } : {}),
    ...(meta ? { meta } : {}),
  };
}
const stub = (env: Pick<Env, 'REGISTRY'>) => env.REGISTRY.get(env.REGISTRY.idFromName('registry'));
async function internal(env: Env, path: string, data: unknown) {
  const r = await stub(env).fetch('https://registry' + path, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!r.ok)
    throw new FeedbackError(
      r.status === 429 ? 429 : 503,
      r.status === 429
        ? 'Too much feedback. Please try again later.'
        : 'Feedback could not be saved. Please try again.',
    );
  return r.json<any>();
}
async function hash(secret: string, label: string, value: string) {
  const enc = new TextEncoder(),
    key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, enc.encode('incord-feedback:' + label + ':' + value)),
    ),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
}
/** Shared app/MCP boundary. Throws FeedbackError (Error with numeric .status):
 * 400 invalid fields, 429 IP/user quota, 503 missing secret/storage unavailable.
 * A durable save always returns success even if email delivery/acknowledgment fails.
 * Only explicit contact is used for reply_to; identity is never a contact default.
 */
export async function submitFeedback(
  request: Request,
  env: Env,
  input: unknown,
  identity?: { uid: string; clientName?: string },
  source: 'app' | 'mcp' = 'app',
): Promise<{ ok: true; message: string }> {
  const value = validateFeedback(input);
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new FeedbackError(503, 'Feedback is not configured');
  const ip = await hash(
    env.SESSION_SECRET,
    'ip',
    request.headers.get('CF-Connecting-IP') || 'unknown',
  );
  const account = identity ? await hash(env.SESSION_SECRET, 'account', identity.uid) : undefined;
  const clientName = identity?.clientName
    ?.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ')
    .trim()
    .slice(0, 100);
  const row: FeedbackRow = {
    ...value,
    id: crypto.randomUUID(),
    at: Date.now(),
    source,
    ...(clientName ? { clientName } : {}),
    ...(account ? { accountRef: account.slice(0, 16) } : {}),
    ...(value.meta ? { meta: { ...value.meta, signedIn: !!identity } } : {}),
  };
  const sink =
    env.EMAIL_TEST_SINK === '1' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  let saved: any;
  try {
    saved = await internal(env, '/feedback/submit', {
      row,
      ip,
      account,
      email: !!env.RESEND_API_KEY || sink,
    });
  } catch (e) {
    if (e instanceof FeedbackError) throw e;
    throw new FeedbackError(503, 'Feedback could not be saved. Please try again.');
  }
  if (saved.reservation) {
    try {
      const summary = saved.more
        ? `\n\n${saved.more} more stored feedback submissions are available in private stats.`
        : '';
      const payload = {
        from: env.EMAIL_FROM || 'Incord <hello@jesklabs.com>',
        to: 'incord@jesklabs.com',
        ...(value.contact ? { reply_to: value.contact } : {}),
        subject: `[Incord feedback] ${value.kind}: ${value.message.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ').slice(0, 60)}`,
        text: `${value.kind} feedback · ${source}\n${new Date(row.at).toISOString()}\n${clientName ? 'Client: ' + clientName + '\n' : ''}${row.accountRef ? 'Account reference: ' + row.accountRef + '\n' : ''}\n${value.message}\n\n${JSON.stringify(row.meta || {})}${summary}`,
      };
      const success =
        sink ||
        (
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
            headers: {
              Authorization: 'Bearer ' + env.RESEND_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          })
        ).ok;
      await internal(env, '/feedback/email-result', { reservation: saved.reservation, success });
    } catch {
      // Release failed delivery reservations; the UTC budget remains spent and all
      // pending rows remain available to the next successful summary.
      try {
        await internal(env, '/feedback/email-result', {
          reservation: saved.reservation,
          success: false,
        });
      } catch {
        /* Lease expiry recovers an interrupted acknowledgment. */
      }
    }
  }
  return { ok: true, message: 'Thanks — Eric reads every one.' };
}

/** Additive tables in the existing RegistryDO, never a new binding. */
export function initializeFeedbackStorage(sql: SqlStorage) {
  sql.exec(
    'CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,at INTEGER NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL,contact TEXT,meta TEXT,source TEXT NOT NULL,clientName TEXT,accountRef TEXT,emailed INTEGER NOT NULL DEFAULT 0)',
  );
  sql.exec('CREATE INDEX IF NOT EXISTS feedback_date ON feedback(at DESC)');
  sql.exec(
    'CREATE TABLE IF NOT EXISTS feedback_limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)',
  );
  sql.exec(
    'CREATE TABLE IF NOT EXISTS feedback_email_budget(day TEXT PRIMARY KEY,count INTEGER NOT NULL)',
  );
  sql.exec(
    'CREATE TABLE IF NOT EXISTS feedback_email_lease(id TEXT PRIMARY KEY,snapshot INTEGER NOT NULL,expires INTEGER NOT NULL)',
  );
  sql.exec(
    'CREATE TABLE IF NOT EXISTS feedback_email_claim(feedback_id TEXT PRIMARY KEY,reservation TEXT NOT NULL)',
  );
}
export function handleFeedbackRegistry(
  sql: SqlStorage,
  storage: DurableObjectStorage,
  path: string,
  data: any,
  now: number,
): Response | null {
  const rows = (q: string, ...args: (string | number)[]) => [
    ...sql.exec<Record<string, string | number | null>>(q, ...args),
  ];
  if (path === '/feedback/list')
    return Response.json({
      feedback: rows(
        'SELECT id,at,kind,message,contact,meta,source,clientName,accountRef FROM feedback ORDER BY at DESC,rowid DESC LIMIT 100',
      ).map((r) => ({ ...r, meta: r.meta ? JSON.parse(String(r.meta)) : undefined })),
    });
  if (path === '/feedback/submit')
    return storage.transactionSync(() => {
      sql.exec('DELETE FROM feedback_limits WHERE expires<=?', now);
      const day = new Date(now).toISOString().slice(0, 10),
        end = (Math.floor(now / 86400000) + 1) * 86400000;
      const limits: [string, number, number][] = [
        ['ip:' + data.ip, 5, now + 3600000],
        ...(data.account
          ? [[`account:${day}:${data.account}`, 10, end] as [string, number, number]]
          : []),
      ];
      for (const [id, limit] of limits)
        if (
          Number(rows('SELECT count FROM feedback_limits WHERE id=?', id)[0]?.count || 0) >= limit
        )
          return Response.json({ error: 'Too much feedback' }, { status: 429 });
      for (const [id, , expires] of limits)
        sql.exec(
          'INSERT INTO feedback_limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1',
          id,
          expires,
        );
      const r = data.row as FeedbackRow;
      sql.exec(
        'INSERT INTO feedback(id,at,kind,message,contact,meta,source,clientName,accountRef) VALUES(?,?,?,?,?,?,?,?,?)',
        r.id,
        r.at,
        r.kind,
        r.message,
        r.contact || null,
        r.meta ? JSON.stringify(r.meta) : null,
        r.source,
        r.clientName || null,
        r.accountRef || null,
      );
      sql.exec(
        'DELETE FROM feedback_email_claim WHERE reservation IN (SELECT id FROM feedback_email_lease WHERE expires<=?)',
        now,
      );
      sql.exec('DELETE FROM feedback_email_lease WHERE expires<=?', now);
      // Claim pending rows per notification: concurrent mail can proceed without
      // losing failed summaries or acknowledging another in-flight notification.
      const budget = Number(
        rows('SELECT count FROM feedback_email_budget WHERE day=?', day)[0]?.count || 0,
      );
      if (!data.email || budget >= 30) return Response.json({ ok: true });
      const pending = rows(
          'SELECT id,rowid FROM feedback WHERE emailed=0 AND id NOT IN (SELECT feedback_id FROM feedback_email_claim)',
        ),
        reservation = crypto.randomUUID();
      for (const item of pending)
        sql.exec('INSERT INTO feedback_email_claim VALUES(?,?)', String(item.id), reservation);
      sql.exec(
        'INSERT INTO feedback_email_budget VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1',
        day,
      );
      sql.exec(
        'INSERT INTO feedback_email_lease VALUES(?,?,?)',
        reservation,
        Math.max(...pending.map((item) => Number(item.rowid))),
        now + 60000,
      );
      return Response.json({ ok: true, reservation, more: pending.length - 1 });
    });
  if (path === '/feedback/email-result')
    return storage.transactionSync(() => {
      const lease = rows(
        'SELECT snapshot FROM feedback_email_lease WHERE id=?',
        data.reservation,
      )[0];
      if (lease && data.success === true)
        sql.exec(
          'UPDATE feedback SET emailed=1 WHERE id IN (SELECT feedback_id FROM feedback_email_claim WHERE reservation=?)',
          data.reservation,
        );
      sql.exec('DELETE FROM feedback_email_claim WHERE reservation=?', data.reservation);
      sql.exec('DELETE FROM feedback_email_lease WHERE id=?', data.reservation);
      return Response.json({ ok: true });
    });
  return null;
}
