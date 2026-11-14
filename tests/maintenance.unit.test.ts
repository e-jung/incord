import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker, { RegistryDO, UserDO, type Env } from '../cloudflare/worker';
import { GroupDO } from '../cloudflare/groups';
import { signStatsCookie } from '../cloudflare/stats';

function state() {
  const db = new DatabaseSync(':memory:'); let tail = Promise.resolve();
  const sql = { exec(query: string, ...args: any[]) { const stmt = db.prepare(query); return stmt.columns().length ? stmt.all(...args) : (stmt.run(...args), []); } };
  const ctx = { id: { toString: () => 'private-do-id' }, storage: { sql,
    deleteAll: async () => { for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]) db.exec('DROP TABLE ' + row.name); },
    transactionSync: (fn: () => any) => fn() },
    blockConcurrencyWhile(fn: () => any) { const result = tail.then(fn); tail = result.catch(() => {}); return result; } } as unknown as DurableObjectState;
  return { db, ctx };
}
const internal = (path: string, data: any = {}) => new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(data) });
function fixture() {
  const env = { SESSION_SECRET: 'session-secret-more-than-32-characters', STATS_TOKEN: 'stats-secret-more-than-32-characters' } as Env;
  const registryState = state(), users = new Map<string, { object: UserDO; db: DatabaseSync }>(), groups = new Map<string, GroupDO>();
  let registry = new RegistryDO(registryState.ctx, env);
  const calls: { uid: string; path: string }[] = [], grants = new Set<string>();
  const oauth = { fail: false, beforeRevoke: undefined as undefined | (() => Promise<void>) };
  const namespace = (fetch: (id: string, request: Request) => Promise<Response>) => ({ idFromName: (id: string) => id,
    get: (id: string) => ({ fetch: (r: string | Request, init?: RequestInit) => fetch(id, r instanceof Request ? r : new Request(r, init)) }) }) as unknown as DurableObjectNamespace;
  env.REGISTRY = namespace((_, request) => registry.fetch(request));
  env.USERS = namespace((uid, request) => { calls.push({ uid, path: new URL(request.url).pathname }); if (!users.has(uid)) { const s = state(); users.set(uid, { object: new UserDO(s.ctx, env), db: s.db }); } return users.get(uid)!.object.fetch(request); });
  env.GROUPS = namespace((id, request) => { if (!groups.has(id)) groups.set(id, new GroupDO(state().ctx, env)); return groups.get(id)!.fetch(request); });
  env.STATS = namespace(async () => Response.json({ ok: true }));
  env.OAUTH_STORAGE = namespace(async (_, request) => { const { uid } = await request.json<any>(); calls.push({ uid, path: new URL(request.url).pathname }); if (oauth.beforeRevoke) await oauth.beforeRevoke(); if (oauth.fail) return Response.json({ error: 'unavailable' }, { status: 503 }); grants.delete(uid); return Response.json({ ok: true }); });
  env.ASSETS = { fetch: async () => new Response(null, { status: 404 }) } as Fetcher;
  const reg = (path: string, data: any = {}) => registry.fetch(internal(path, data));
  const init = async (uid: string, kind?: string) => {
    await env.USERS.get(env.USERS.idFromName(uid)).fetch(internal('/init'));
    const db = users.get(uid)!.db;
    db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify({ displayName: 'PRIVATE NAME', createdAt: Date.UTC(2026, 0, 2) }), 'profile');
    db.prepare('INSERT INTO items VALUES(?,?,?)').run('private-item', JSON.stringify({ text: 'PRIVATE TEXT' }), 1);
    db.prepare('INSERT INTO events VALUES(?,?)').run('private-event', '{}');
    db.prepare('INSERT INTO subscriptions VALUES(?,?)').run('private-push-endpoint', '{}');
    db.prepare('INSERT INTO credentials VALUES(?,?)').run('legacy-credential', '{}');
    await reg('/schedule/set', { uid }); grants.add(uid);
    if (kind) registryState.db.prepare('INSERT INTO mapping VALUES(?,?,?)').run(kind, kind + '-key-' + uid, uid);
  };
  const request = (input: any = {}, options: { method?: string; token?: string; cookie?: string; origin?: string } = {}) => {
    const method = options.method || 'POST';
    return worker.fetch(new Request('https://app.test/stats/maintenance/orphans', { method,
      headers: { Origin: options.origin ?? 'https://app.test', 'Content-Type': 'application/json', ...(options.cookie ? { Cookie: options.cookie } : { Authorization: 'Bearer ' + (options.token ?? env.STATS_TOKEN) }) },
      ...(['GET', 'HEAD'].includes(method) ? {} : { body: JSON.stringify(input) }) }), env, {} as ExecutionContext);
  };
  return { env, init, reg, request, calls, users, grants, oauth, db: registryState.db,
    reload: () => { registry = new RegistryDO(registryState.ctx, env); } };
}
afterEach(() => vi.restoreAllMocks());

describe('administrator orphan account maintenance', () => {
  it('requires stats authentication, POST, same-origin and a boolean confirmation', async () => {
    const f = fixture();
    expect((await f.request({}, { token: 'wrong' })).status).toBe(401);
    const anonymous = new Request('https://app.test/stats/maintenance/orphans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect((await worker.fetch(anonymous, f.env, {} as ExecutionContext)).status).toBe(401);
    expect((await f.request({}, { method: 'GET' })).status).toBe(405);
    expect((await f.request({}, { method: 'DELETE' })).status).toBe(405);
    expect((await f.request({}, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await f.request({ confirm: 'true' })).status).toBe(400);
    expect((await f.request({ limit: 26 })).status).toBe(400);
    expect((await f.request({}, { cookie: 'incord_stats=' + await signStatsCookie(f.env.STATS_TOKEN!) })).status).toBe(200);
    f.env.STATS_TOKEN = undefined;
    expect((await f.request()).status).toBe(503);
    expect(f.calls).toEqual([]);
  });

  it('dry-runs by default, exposes only counts and created dates, and never touches mapped accounts', async () => {
    const f = fixture();
    await f.init('orphan', 'webauthn'); await f.init('email-user', 'email'); await f.init('google-user', 'google');
    f.calls.length = 0;
    const result = await (await f.request()).json<any>();
    expect(result).toEqual({ dryRun: true, indexedAccounts: 3, orphanAccounts: 1, selectedAccounts: 1, deletedAccounts: 0, skippedAccounts: 0, createdDates: ['2026-01-02'] });
    expect(f.calls).toEqual([{ uid: 'orphan', path: '/maintenance/metadata' }]);
    expect(f.grants.size).toBe(3);
    expect(f.users.get('orphan')!.db.prepare('SELECT count(*) n FROM subscriptions').get()).toMatchObject({ n: 1 });
    for (const secret of ['orphan', 'email-user', 'google-user', 'PRIVATE TEXT', 'private-do-id']) expect(JSON.stringify(result)).not.toContain('"' + secret + '"');
  });

  it('uses the full deletion path including owned/joined groups, OAuth, push and all user data', async () => {
    const f = fixture(); await f.init('orphan'); await f.init('mapped', 'email');
    const owned = await (await f.reg('/groups/create', { uid: 'orphan', name: 'Owned' })).json<any>();
    const joined = await (await f.reg('/groups/create', { uid: 'mapped', name: 'Joined' })).json<any>();
    await f.reg('/groups/join', { uid: 'orphan', code: joined.invite.code, ip: 'local' });
    f.db.prepare('INSERT INTO challenges VALUES(?,?,?)').run('private-challenge', JSON.stringify({ uid: 'orphan' }), Date.now() + 60000);
    f.db.prepare('INSERT INTO email_codes VALUES(?,?,?,?,?)').run('pending-email', 'hash', Date.now() + 60000, 0, 'orphan');
    const before = f.db.prepare('SELECT value FROM groups_registry ORDER BY id').all();
    expect(await (await f.request()).json()).toMatchObject({ dryRun: true, deletedAccounts: 0 });
    expect(f.db.prepare('SELECT value FROM groups_registry ORDER BY id').all()).toEqual(before);
    expect(f.grants).toEqual(new Set(['orphan', 'mapped']));
    f.calls.length = 0;
    expect(await (await f.request({ confirm: true })).json()).toMatchObject({ deletedAccounts: 1, createdDates: ['2026-01-02'] });
    expect(f.calls.filter(c => c.uid === 'orphan').map(c => c.path)).toEqual(['/maintenance/metadata', '/revoke-all', '/delete']);
    expect(f.calls.some(c => c.uid === 'mapped')).toBe(false);
    expect(f.grants).toEqual(new Set(['mapped']));
    const db = f.users.get('orphan')!.db;
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([{ name: 'meta' }]);
    expect(db.prepare('SELECT * FROM meta').all()).toEqual([{ key: 'deleted', value: 'true' }]);
    for (const table of ['mapping', 'schedule', 'email_codes']) expect(f.db.prepare('SELECT count(*) n FROM ' + table + ' WHERE uid=?').get('orphan')).toMatchObject({ n: 0 });
    expect(f.db.prepare('SELECT count(*) n FROM challenges').get()).toMatchObject({ n: 0 });
    const rows = f.db.prepare('SELECT id,value FROM groups_registry').all() as any[];
    expect(JSON.parse(rows.find(r => r.id === owned.group.id).value)).toMatchObject({ deleted: true, members: [] });
    expect(JSON.parse(rows.find(r => r.id === joined.group.id).value).members.map((m: any) => m.uid)).toEqual(['mapped']);
    expect(await (await f.request({ confirm: true })).json()).toMatchObject({ orphanAccounts: 0, deletedAccounts: 0 });
  });

  it('audits the actual legacy registry references, not unreachable Durable Object enumeration', async () => {
    const f = fixture(); await f.init('schedule-only'); await f.init('legacy-key', 'webauthn'); await f.init('group-only'); await f.init('unindexed');
    await f.reg('/groups/create', { uid: 'group-only', name: 'Legacy group' });
    f.db.prepare('DELETE FROM schedule WHERE uid IN (?,?)').run('group-only', 'unindexed');
    f.db.exec('DELETE FROM accounts'); f.reload(); f.calls.length = 0;
    const result = await (await f.request()).json<any>();
    expect(result).toMatchObject({ indexedAccounts: 3, orphanAccounts: 3, selectedAccounts: 3 });
    expect(f.calls.map(c => c.uid).sort()).toEqual(['group-only', 'legacy-key', 'schedule-only']);
  });

  it('rechecks mappings at claim time and blocks linking during and after cleanup', async () => {
    const f = fixture(); await f.init('newly-mapped');
    expect((await f.reg('/jl/resolve', { uid: 'newly-mapped', sub: 'jl1_newemail' })).status).toBe(200);
    expect(await (await f.reg('/maintenance/claim', { uid: 'newly-mapped' })).json()).toEqual({ claimed: false });
    await f.init('orphan');
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    f.oauth.beforeRevoke = async () => { entered(); await blocked; };
    const deletion = f.request({ confirm: true }); await ready;
    // Registry stays available while cleanup awaits other DOs; a durable claim
    // denies links and duplicate maintenance instead of racing the deletion.
    expect((await f.reg('/jl/resolve', { uid: 'orphan', sub: 'jl1_orphan' })).status).toBe(401);
    expect(await (await f.reg('/maintenance/claim', { uid: 'orphan' })).json()).toEqual({ claimed: false });
    release(); expect((await deletion).status).toBe(200);
    expect((await f.reg('/jl/resolve', { uid: 'orphan', sub: 'jl1_orphan' })).status).toBe(401);
    expect((await f.reg('/schedule/set', { uid: 'orphan' })).status).toBe(401);
    expect(f.calls.some(c => c.uid === 'newly-mapped' && c.path !== '/init')).toBe(false);
  });

  it('blocks delayed group create and join requests during and after orphan cleanup', async () => {
    const f = fixture(); await f.init('orphan'); await f.init('mapped', 'email');
    const other = await (await f.reg('/groups/create', { uid: 'mapped', name: 'Surviving group' })).json<any>();
    const delayed = [
      internal('/groups/create', { uid: 'orphan', name: 'Delayed create' }),
      internal('/groups/join', { uid: 'orphan', code: other.invite.code, ip: 'local' }),
    ];
    expect(await (await f.reg('/maintenance/claim', { uid: 'orphan' })).json()).toEqual({ claimed: true });
    for (const request of delayed) expect((await f.env.REGISTRY.get(f.env.REGISTRY.idFromName('registry')).fetch(request.clone())).status).toBe(401);
    await f.reg('/maintenance/release', { uid: 'orphan' });
    expect(await (await f.request({ confirm: true })).json()).toMatchObject({ deletedAccounts: 1 });
    for (const request of delayed) expect((await f.env.REGISTRY.get(f.env.REGISTRY.idFromName('registry')).fetch(request)).status).toBe(401);
    expect(await (await f.reg('/groups/list', { uid: 'mapped' })).json()).toMatchObject({ groups: [{ id: other.group.id }] });
    const rows = f.db.prepare('SELECT value FROM groups_registry').all() as any[];
    expect(rows).toHaveLength(1); expect(JSON.parse(rows[0].value).members.map((m: any) => m.uid)).toEqual(['mapped']);
  });

  it('fails closed before destructive cleanup on OAuth failure, and retries durable claims', async () => {
    const f = fixture(); await f.init('orphan'); f.oauth.fail = true; f.calls.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await f.request({ confirm: true })).status).toBe(503);
    expect(f.calls.some(c => c.path === '/delete')).toBe(false);
    expect(f.users.get('orphan')!.db.prepare('SELECT count(*) n FROM subscriptions').get()).toMatchObject({ n: 1 });
    expect((await f.reg('/jl/resolve', { uid: 'orphan', sub: 'jl1_orphan' })).status).toBe(401);
    f.oauth.fail = false; f.reload();
    expect(await (await f.request({ confirm: true })).json()).toMatchObject({ deletedAccounts: 1 });
  });
});
