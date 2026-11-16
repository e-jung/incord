import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import worker, { RegistryDO, UserDO, type Env } from '../cloudflare/worker';
import { GroupDO, handleGroups, projectGroupsAttention } from '../cloudflare/groups';

const databases: DatabaseSync[] = [];
function state() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  let tail = Promise.resolve();
  return {
    id: { toString: () => crypto.randomUUID() },
    storage: {
      sql: {
        exec(q: string, ...args: any[]) {
          const stmt = db.prepare(q);
          return stmt.columns().length ? stmt.all(...args) : (stmt.run(...args), []);
        },
      },
      transactionSync(fn: () => any) {
        db.exec('SAVEPOINT tx');
        try {
          const out = fn();
          db.exec('RELEASE tx');
          return out;
        } catch (error) {
          db.exec('ROLLBACK TO tx');
          db.exec('RELEASE tx');
          throw error;
        }
      },
    },
    blockConcurrencyWhile(fn: () => any) {
      const out = tail.then(fn);
      tail = out.catch(() => {});
      return out;
    },
  } as unknown as DurableObjectState;
}
function fixture() {
  const env = {} as Env,
    users = new Map<string, UserDO>(),
    groups = new Map<string, GroupDO>(),
    calls: { id: string; path: string }[] = [];
  const registry = new RegistryDO(state(), env);
  const namespace = (get: (id: string) => any) =>
    ({
      idFromName: (id: string) => id,
      get: (id: string) => ({
        fetch: async (r: Request) => {
          calls.push({ id, path: new URL(r.url).pathname });
          return get(id).fetch(r);
        },
      }),
    }) as unknown as DurableObjectNamespace;
  Object.assign(env, {
    SESSION_SECRET: 'attention-test-secret-more-than-32-characters',
    REGISTRY: namespace(() => registry),
    USERS: namespace((id) => {
      if (!users.has(id)) users.set(id, new UserDO(state(), env));
      return users.get(id)!;
    }),
    GROUPS: namespace((id) => {
      if (!groups.has(id)) groups.set(id, new GroupDO(state(), env));
      return groups.get(id)!;
    }),
    ASSETS: {
      fetch: async (r: Request) => {
        try {
          return new Response(await readFile(resolve('public', new URL(r.url).pathname.slice(1))));
        } catch {
          return new Response(null, { status: 404 });
        }
      },
    },
  });
  const callUser = async (uid: string, path: string, data: any = {}) => {
    const r = await env.USERS.get(env.USERS.idFromName(uid)).fetch(
      new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(data) }),
    );
    return { status: r.status, ...(await r.json<any>()) };
  };
  const init = async (uid: string) => {
    await callUser(uid, '/init', { name: uid });
  };
  const api = async (uid: string, path = '', input: any = {}, method = 'POST') =>
    (
      await handleGroups(
        new Request('https://incord.test/api/groups' + path, { method }),
        env,
        uid,
        input,
      )
    ).json<any>();
  const list = (uid: string) => api(uid, '', {}, 'GET');
  return { env, init, api, list, callUser, calls, users };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});
const group = (id: string, total: number, learned: number, extra: any = {}) => ({
  id,
  role: 'member',
  goal: { total },
  members: [
    {
      self: true,
      goalStatus: learned === total ? 'learned' : learned ? 'learning' : 'not started',
      goalTotal: total,
      goalLearned: learned,
    },
  ],
  ...extra,
});

describe('Groups attention projection', () => {
  it.each([
    [5, 4, 1],
    [10, 8, 1],
    [10, 9, 1],
    [4, 3, 0],
    [10, 7, 0],
    [20, 16, 0],
    [5, 5, 0],
    [5, 0, 0],
    [0, 0, 0],
  ])('requires >=80% and 1–2 remaining: %i total, %i learned', (total, learned, count) => {
    expect(projectGroupsAttention([group('goal', total, learned)], 0)).toEqual({
      pendingRequests: 0,
      prayersToday: 0,
      goalsNearlyDone: count,
      ...(count ? { groupId: 'goal' } : {}),
    });
  });
  it('uses only the current user, started assigned goals, and owner/admin visible requests; pending wins navigation', () => {
    const others = group('others', 5, 0);
    others.members.push({ self: false, goalStatus: 'learning', goalTotal: 5, goalLearned: 4 });
    const out = projectGroupsAttention(
      [
        group('near', 10, 8),
        others,
        group('not-assigned', 5, 4, { goal: null }),
        group('hidden', 5, 0, { pending: [{}, {}] }),
        group('admin', 5, 0, { role: 'admin', pending: [{}, {}] }),
        group('owner', 5, 0, { role: 'owner', pending: [{}] }),
      ],
      3,
    );
    expect(out).toEqual({
      pendingRequests: 3,
      prayersToday: 3,
      goalsNearlyDone: 1,
      groupId: 'admin',
    });
    expect(projectGroupsAttention([], 2)).toEqual({
      pendingRequests: 0,
      prayersToday: 2,
      goalsNearlyDone: 0,
    });
  });
  it('adds attention to GET without changing the existing lists or exposing new member details', async () => {
    const f = fixture();
    for (const u of ['owner', 'admin', 'member', 'requester', 'requester2']) await f.init(u);
    const c = await f.api('owner', '', { name: 'Managed', approveNewMembers: true }),
      id = c.group.id;
    for (const u of ['admin', 'member']) {
      await f.api(u, '/join', { code: c.invite.code });
      const target = (await f.list('owner')).groups[0].pending.find((m: any) => m.name === u);
      await f.api('owner', '/' + id + '/approve', { memberId: target.id });
    }
    const admin = (await f.list('owner')).groups[0].members.find((m: any) => m.name === 'admin');
    await f.api('owner', '/' + id + '/role', { memberId: admin.id, role: 'admin' });
    for (const u of ['requester', 'requester2']) await f.api(u, '/join', { code: c.invite.code });
    for (const u of ['owner', 'admin'])
      expect((await f.list(u)).attention).toEqual({
        pendingRequests: 2,
        prayersToday: 0,
        goalsNearlyDone: 0,
        groupId: id,
      });
    const member = await f.list('member');
    expect(member.attention.pendingRequests).toBe(0);
    expect(member.groups[0].pending).toBeUndefined();
    const requester = await f.list('requester');
    expect(requester.groups).toEqual([]);
    expect(requester.pending).toHaveLength(1);
    expect(requester.attention).toEqual({
      pendingRequests: 0,
      prayersToday: 0,
      goalsNearlyDone: 0,
    });
    const pending = (await f.list('owner')).groups[0].pending;
    await f.api('owner', '/' + id + '/approve', { memberId: pending[0].id });
    await f.api('owner', '/' + id + '/remove', { memberId: pending[1].id });
    expect((await f.list('owner')).attention.pendingRequests).toBe(0);
  });
  it('counts the signed-in goal only, excluding deleted items, and adds one scalar read, not per-group reads', async () => {
    const f = fixture();
    await f.init('owner');
    await f.init('member');
    const c = await f.api('owner', '', { name: 'Goal' }),
      id = c.group.id;
    await f.api('member', '/join', { code: c.invite.code });
    const { group: g } = await f.api('owner', '/' + id + '/goal', {
      selection: { kind: 'document', id: 'wsc', translation: 'BSB', start: 1, end: 10 },
    });
    const items = g.goal.itemIds.map((id: string, i: number) => ({
      id,
      title: 'Private title',
      learned: i < 8,
      updatedAt: 1,
    }));
    await f.callUser('owner', '/sync', { items });
    f.calls.length = 0;
    const out = await f.list('owner');
    expect(out.attention).toEqual({
      pendingRequests: 0,
      prayersToday: 0,
      goalsNearlyDone: 1,
      groupId: id,
    });
    expect(f.calls.filter((c) => c.path === '/groups/attention')).toEqual([
      { id: 'owner', path: '/groups/attention' },
    ]);
    expect(f.calls.filter((c) => c.path === '/groups/state')).toHaveLength(2);
    expect((await f.list('member')).attention.goalsNearlyDone).toBe(0);
    await f.callUser('owner', '/sync', { items: [{ ...items[0], deleted: true, updatedAt: 2 }] });
    expect((await f.list('owner')).attention.goalsNearlyDone).toBe(0);
    await f.callUser('owner', '/sync', {
      items: items.map((i: any) => ({ ...i, learned: true, updatedAt: 3 })),
    });
    expect((await f.list('owner')).attention.goalsNearlyDone).toBe(0);
  });
  it('counts received rather than outgoing prayers without push and preserves cross-group dedup across local days', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-14T23:59:00Z'));
    const f = fixture();
    for (const u of ['sender', 'recipient', 'other']) await f.init(u);
    const a = await f.api('sender', '', { name: 'First' }),
      b = await f.api('other', '', { name: 'Second' });
    await f.api('recipient', '/join', { code: a.invite.code });
    for (const u of ['sender', 'recipient']) await f.api(u, '/join', { code: b.invite.code });
    const target = (g: any) => g.members.find((m: any) => m.name === 'recipient').id;
    await f.api('sender', '/' + a.group.id + '/pray', {
      memberId: target((await f.list('sender')).groups.find((g: any) => g.id === a.group.id)),
    });
    const again = await f.api('sender', '/' + b.group.id + '/pray', {
      memberId: target((await f.list('sender')).groups.find((g: any) => g.id === b.group.id)),
    });
    expect(again.alreadySent).toBe(true);
    await f.api('other', '/' + b.group.id + '/pray', {
      memberId: target((await f.list('other')).groups[0]),
    });
    expect((await f.list('sender')).attention.prayersToday).toBe(0);
    const received = await f.list('recipient');
    expect(received.attention).toEqual({ pendingRequests: 0, prayersToday: 2, goalsNearlyDone: 0 });
    const scalar = await f.callUser('recipient', '/groups/attention');
    expect(scalar).toEqual({ status: 200, prayersToday: 2 });
    expect(JSON.stringify(received.attention)).not.toMatch(/sender|recipient|body|tag|hash/);
    // Attention follows the recipient's local day; reservations still dedup in UTC.
    await f.callUser('recipient', '/sync', {
      settings: { updatedAt: 1, timezone: 'America/Los_Angeles' },
    });
    expect((await f.list('recipient')).attention.prayersToday).toBe(2);
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-15T00:01:00Z'));
    expect((await f.list('recipient')).attention.prayersToday).toBe(2);
    // Read-only projections must not consume today's prayer reservation.
    expect(
      (
        await f.api('sender', '/' + a.group.id + '/pray', {
          memberId: target((await f.list('sender')).groups.find((g: any) => g.id === a.group.id)),
        })
      ).alreadySent,
    ).toBeUndefined();
    expect((await f.list('recipient')).attention.prayersToday).toBe(2);
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-15T07:59:00Z'));
    expect((await f.list('recipient')).attention.prayersToday).toBe(2);
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-15T08:00:00Z'));
    expect((await f.list('recipient')).attention.prayersToday).toBe(0);
    // A duplicate must not refresh the received timestamp after local midnight.
    expect(
      (
        await f.api('sender', '/' + a.group.id + '/pray', {
          memberId: target((await f.list('sender')).groups.find((g: any) => g.id === a.group.id)),
        })
      ).alreadySent,
    ).toBe(true);
    expect((await f.list('recipient')).attention.prayersToday).toBe(0);
    // Another sender can reserve on this UTC day even though local midnight just passed.
    await f.api('other', '/' + b.group.id + '/pray', {
      memberId: target((await f.list('other')).groups[0]),
    });
    expect((await f.list('recipient')).attention.prayersToday).toBe(1);
  });
  it('respects prayer encouragement opt-out without changing reservations or timestamps', async () => {
    const f = fixture();
    await f.init('recipient');
    const senderHash = 'c'.repeat(64);
    await f.callUser('recipient', '/sync', {
      settings: { updatedAt: 1, groupReceivePrayer: false },
    });
    expect(
      (await f.callUser('recipient', '/groups/prayer', { senderHash, kind: 'prayer' })).alreadySent,
    ).toBeUndefined();
    expect((await f.list('recipient')).attention.prayersToday).toBe(0);
    const timestamp = (f.users.get('recipient') as any).get('group-prayer-received:' + senderHash);
    expect(timestamp).toBeTypeOf('number');
    await f.callUser('recipient', '/sync', {
      settings: { updatedAt: 2, groupReceivePrayer: true },
    });
    expect((await f.list('recipient')).attention.prayersToday).toBe(1);
    expect(
      (await f.callUser('recipient', '/groups/prayer', { senderHash, kind: 'prayer' })).alreadySent,
    ).toBe(true);
    expect((f.users.get('recipient') as any).get('group-prayer-received:' + senderHash)).toBe(
      timestamp,
    );
  });
  it.each([undefined, 'UTC'])(
    'uses UTC when timezone is %s and leaves legacy UTC reservations unchanged',
    async (timezone) => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-14T23:59:00Z'));
      const f = fixture();
      await f.init('recipient');
      if (timezone)
        await f.callUser('recipient', '/sync', { settings: { updatedAt: 1, timezone } });
      const recipient = f.users.get('recipient') as any,
        legacy = 'a'.repeat(64),
        fresh = 'b'.repeat(64);
      recipient.set('group-prayer:' + legacy, '2026-11-14');
      expect(await f.callUser('recipient', '/groups/attention')).toEqual({
        status: 200,
        prayersToday: 0,
      });
      expect(
        (await f.callUser('recipient', '/groups/prayer', { senderHash: legacy, kind: 'prayer' }))
          .alreadySent,
      ).toBe(true);
      expect(recipient.get('group-prayer:' + legacy)).toBe('2026-11-14');
      expect(recipient.get('group-prayer-received:' + legacy)).toBeNull();
      await f.callUser('recipient', '/groups/prayer', { senderHash: fresh, kind: 'prayer' });
      expect(recipient.get('group-prayer:' + fresh)).toBe('2026-11-14');
      expect(recipient.get('group-prayer-received:' + fresh)).toBe(Date.now());
      expect((await f.list('recipient')).attention.prayersToday).toBe(1);
      vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-15T00:01:00Z'));
      expect((await f.list('recipient')).attention.prayersToday).toBe(0);
      expect(
        (await f.callUser('recipient', '/groups/prayer', { senderHash: legacy, kind: 'prayer' }))
          .alreadySent,
      ).toBeUndefined();
      expect(recipient.get('group-prayer:' + legacy)).toBe('2026-11-15');
      expect((await f.list('recipient')).attention.prayersToday).toBe(1);
    },
  );
  it('requires initialized, active account state for scalar counts and keeps public GET authenticated', async () => {
    const f = fixture();
    expect((await f.callUser('missing', '/groups/attention')).status).toBe(401);
    const r = await worker.fetch(
      new Request('https://incord.test/api/groups'),
      f.env,
      {} as ExecutionContext,
    );
    expect(r.status).toBe(401);
  });
});
