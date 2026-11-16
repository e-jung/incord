import { afterEach, describe, it, expect, vi } from 'vitest';
import { runMcpTool } from '../cloudflare/mcp-tools';
import { b64 } from '../cloudflare/worker';
import { GroupDO, getGroups, cleanupGroups, normalizeInviteCode } from '../cloudflare/groups';
import { fixture } from './groups.fixture';
afterEach(() => vi.restoreAllMocks());
describe('serialized Groups membership and authorization', () => {
  it('creates the public shape and never exposes identities or library internals', async () => {
    const f = fixture();
    await f.init('secret-owner', { name: 'Grace' });
    const { group, invite } = await f.api('secret-owner', '', { name: 'Friends' });
    expect(group).toMatchObject({
      name: 'Friends',
      role: 'owner',
      memberCount: 1,
      weeklyPush: true,
    });
    expect(invite.code).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(invite.url).toBe('/join/' + normalizeInviteCode(invite.code));
    expect(JSON.stringify(group)).not.toContain('secret-owner');
    expect(group.members[0].name).toBe('Grace');
  });
  it('serializes concurrent owner and total caps, including pending reservations', async () => {
    const f = fixture();
    await f.init('owner');
    const creates = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => f.api('owner', '', { name: 'G' + i })),
    );
    expect(creates.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    await f.init('joiner');
    for (let i = 0; i < 6; i++) {
      await f.init('host' + i);
      const c = await f.api('host' + i, '', { name: 'Host', approveNewMembers: true });
      if (i < 5)
        expect(await f.api('joiner', '/join', { code: c.invite.code })).toMatchObject({
          pending: true,
        });
      else
        await expect(f.api('joiner', '/join', { code: c.invite.code })).rejects.toMatchObject({
          status: 409,
        });
    }
  });
  it('lists persisted pending requests with only safe summaries and frees the membership cap on withdrawal', async () => {
    const f = fixture();
    await f.init('requester');
    const created = [];
    for (let i = 0; i < 6; i++) {
      await f.init('host' + i, { displayName: 'Host ' + i });
      const c = await f.api('host' + i, '', { name: 'Request ' + i, approveNewMembers: true });
      created.push(c);
      if (i < 5) await f.api('requester', '/join', { code: c.invite.code });
    }
    await expect(
      f.api('requester', '/join', { code: created[5].invite.code }),
    ).rejects.toMatchObject({ status: 409 });
    const id = created[0].group.id;
    await f.api('host0', '/' + id + '/goal', {
      selection: { kind: 'passage', id: 'psalm-23', translation: 'BSB' },
    });
    await f.api('host0', '/' + id + '/update', { name: 'Renamed while pending' });
    // Reconstruct the canonical object from its durable SQLite storage, as after eviction/reload.
    const persisted = f.groups.get(id) as any;
    f.groups.set(id, new GroupDO(persisted.ctx, f.env));
    f.invocations.length = 0;
    f.root.calls = 0;
    const listed = await f.api('requester', '', {}, 'GET');
    expect(listed.groups).toEqual([]);
    expect(listed.pending).toHaveLength(5);
    expect(listed.pending[0]).toEqual({
      id,
      name: 'Renamed while pending',
      ownerName: 'Host 0',
      requestedAt: expect.any(Number),
    });
    for (const request of listed.pending)
      expect(Object.keys(request).sort()).toEqual(['id', 'name', 'ownerName', 'requestedAt']);
    expect(f.root.calls).toBe(7);
    expect(f.invocations.some((i) => ['/project', '/view'].includes(i.path))).toBe(false);
    const mcp = await runMcpTool('get_groups', {}, {
      groups: () => getGroups(f.env, 'requester'),
    } as any);
    const { attention, ...lists } = listed;
    expect(attention).toEqual({ pendingRequests: 0, prayersToday: 0, goalsNearlyDone: 0 });
    expect(mcp).toEqual(lists);
    for (const secret of ['members', 'goal', 'host0', 'uid', 'revision', 'invite', 'Psalm 23'])
      expect(JSON.stringify(mcp)).not.toContain(secret);
    await expect(f.api('requester', '/' + id, {}, 'GET')).rejects.toMatchObject({ status: 404 });
    await expect(f.api('requester', '/' + id + '/goal/add')).rejects.toMatchObject({ status: 404 });
    await f.api('requester', '/' + listed.pending[0].id + '/leave');
    expect((await f.api('requester', '', {}, 'GET')).pending).toHaveLength(4);
    expect(await f.api('requester', '/join', { code: created[5].invite.code })).toMatchObject({
      pending: true,
    });
    expect((await getGroups(f.env, 'requester')).pending.map((p) => p.id)).not.toContain(id);
  });
  it('checks canonical pending membership and revision without granting active group views', async () => {
    const f = fixture();
    for (const uid of ['host', 'pending', 'outsider']) await f.init(uid);
    const c = await f.api('host', '', { name: 'Private', approveNewMembers: true }),
      id = c.group.id;
    await f.api('pending', '/join', { code: c.invite.code });
    const index = JSON.parse(
      [...(f.registry as any).sql.exec('SELECT value FROM groups_registry')][0].value,
    );
    const internal = async (path: string, uid: string, revision = index.revision) => {
      const response = await f.env.GROUPS!.get(f.env.GROUPS!.idFromName(id)).fetch(
        new Request('https://internal' + path, {
          method: 'POST',
          body: JSON.stringify({ uid, revision }),
        }),
      );
      return { status: response.status, body: await response.json<any>() };
    };
    expect((await internal('/pending-view', 'pending')).body).toEqual({
      id,
      name: 'Private',
      ownerName: 'host',
      requestedAt: expect.any(Number),
    });
    for (const uid of ['outsider', 'host'])
      expect((await internal('/pending-view', uid)).status).toBe(404);
    expect((await internal('/pending-view', 'pending', index.revision - 1)).status).toBe(503);
    expect((await internal('/view', 'pending')).status).toBe(404);
    const member = (await getGroups(f.env, 'host')).groups[0].pending[0];
    await f.api('host', '/' + id + '/approve', { memberId: member.id });
    const approved = await getGroups(f.env, 'pending');
    expect(approved.pending).toEqual([]);
    expect(approved.groups).toHaveLength(1);
    expect((await internal('/pending-view', 'pending', index.revision + 1)).status).toBe(404);
    await f.api('pending', '/' + id + '/leave');
    expect(await getGroups(f.env, 'pending')).toEqual({ groups: [], pending: [] });
  });
  it('notifies only active managers once per requester across retries, withdrawal and rejoin, and approval not decline', async () => {
    const f = fixture();
    for (const uid of ['owner', 'admin', 'member', 'requester', 'declined'])
      await f.init(uid, {
        remindersEnabled: true,
        displayName: uid === 'requester' ? 'Grace' : uid,
      });
    const c = await f.api('owner', '', { name: 'Circle' }),
      id = c.group.id;
    for (const uid of ['admin', 'member']) await f.api(uid, '/join', { code: c.invite.code });
    const admin = (await getGroups(f.env, 'owner')).groups[0].members.find(
      (m: any) => m.name === 'admin',
    );
    await f.api('owner', '/' + id + '/role', { memberId: admin.id, role: 'admin' });
    await f.api('owner', '/' + id + '/update', { approveNewMembers: true });
    f.invocations.length = 0;
    const join = () => f.api('requester', '/join', { code: c.invite.code });
    expect(await join()).toMatchObject({ pending: true, ownerName: 'owner' });
    await join();
    expect(f.pushBodies).toHaveLength(2);
    expect(
      f.pushBodies.every((p) => p.kind === 'join' && p.body === 'Grace asked to join Circle'),
    ).toBe(true);
    const recipients = f.invocations.filter((i) => i.path === '/groups/push').map((i) => i.name);
    expect(recipients.sort()).toEqual(['user:admin', 'user:owner']);
    await f.api('requester', '/' + id + '/leave');
    await join();
    expect(f.pushBodies).toHaveLength(2);
    let pending = (await getGroups(f.env, 'owner')).groups[0].pending;
    await expect(
      f.api('member', '/' + id + '/approve', { memberId: pending[0].id }),
    ).rejects.toMatchObject({ status: 403 });
    await f.api('admin', '/' + id + '/approve', { memberId: pending[0].id });
    await f.api('admin', '/' + id + '/approve', { memberId: pending[0].id });
    expect(f.pushBodies).toHaveLength(3);
    expect(f.pushBodies[2]).toMatchObject({ kind: 'approved', body: 'You’re in Circle' });
    await f.api('declined', '/join', { code: c.invite.code });
    const before = f.pushBodies.length;
    pending = (await getGroups(f.env, 'owner')).groups[0].pending;
    await f.api('owner', '/' + id + '/remove', { memberId: pending[0].id });
    expect(f.pushBodies).toHaveLength(before);
    expect(await getGroups(f.env, 'declined')).toEqual({ groups: [], pending: [] });
    expect(f.pushBodies[0].tag).not.toBe(f.pushBodies[before - 1].tag);
    await f.api('declined', '/join', { code: c.invite.code });
    expect(f.pushBodies).toHaveLength(before);
    expect(Math.max(...f.invocations.map((i) => i.calls))).toBeLessThanOrEqual(32);
  });
  it('honors global push enabled for join and approval before encrypted delivery', async () => {
    const f = fixture();
    for (const uid of ['owner', 'first', 'second', 'third'])
      await f.init(uid, { remindersEnabled: false });
    const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    f.env.VAPID_PUBLIC_KEY = b64(
      new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey)),
    );
    f.env.VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d;
    for (const uid of ['owner', 'first', 'second', 'third'])
      await f.callUser(uid, '/push/subscribe', {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/' + uid,
          keys: {
            p256dh: b64(new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey))),
            auth: b64(crypto.getRandomValues(new Uint8Array(16))),
          },
        },
      });
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));
    const c = await f.api('owner', '', { name: 'Push', approveNewMembers: true }),
      id = c.group.id;
    const request = async (uid: string) => {
      await f.api(uid, '/join', { code: c.invite.code });
      return (await getGroups(f.env, 'owner')).groups[0].pending.find((m: any) => m.name === uid);
    };
    const first = await request('first');
    await f.api('owner', '/' + id + '/approve', { memberId: first.id });
    expect(network).not.toHaveBeenCalled();
    await f.callUser('owner', '/sync', { settings: { updatedAt: 2, remindersEnabled: true } });
    await f.callUser('second', '/sync', { settings: { updatedAt: 2, remindersEnabled: true } });
    const second = await request('second');
    expect(network).toHaveBeenCalledTimes(1);
    await f.api('owner', '/' + id + '/approve', { memberId: second.id });
    expect(network).toHaveBeenCalledTimes(2);
    const third = await request('third');
    expect(network).toHaveBeenCalledTimes(3);
    await f.api('owner', '/' + id + '/remove', { memberId: third.id });
    expect(network).toHaveBeenCalledTimes(3);
    for (const [, init] of network.mock.calls) {
      expect(new Headers(init!.headers).get('Content-Encoding')).toBe('aes128gcm');
      expect(new TextDecoder().decode(init!.body as Uint8Array)).not.toMatch(
        /asked to join|You’re in/,
      );
    }
  });
  it('replays a failed roster install without duplicating pending or approval notifications after eviction', async () => {
    const f = fixture();
    for (const uid of ['owner', 'requester']) await f.init(uid);
    const c = await f.api('owner', '', { name: 'Durable approvals', approveNewMembers: true }),
      id = c.group.id;
    f.fault.install = true;
    await expect(f.api('requester', '/join', { code: c.invite.code })).rejects.toThrow();
    f.fault.install = false;
    await f.api('requester', '/join', { code: c.invite.code });
    expect(f.pushBodies).toHaveLength(1);
    const object = f.groups.get(id) as any;
    f.groups.set(id, new GroupDO(object.ctx, f.env));
    await f.api('requester', '/' + id + '/leave');
    await f.api('requester', '/join', { code: c.invite.code });
    expect(f.pushBodies).toHaveLength(1);
    const target = (await getGroups(f.env, 'owner')).groups[0].pending[0];
    f.fault.install = true;
    await expect(f.api('owner', '/' + id + '/approve', { memberId: target.id })).rejects.toThrow();
    f.fault.install = false;
    await f.api('owner', '/' + id + '/approve', { memberId: target.id });
    expect(f.pushBodies).toHaveLength(2);
  });
  it('enforces 30 members under concurrent joins', async () => {
    const f = fixture();
    await f.init('owner');
    const c = await f.api('owner', '', { name: 'Capacity' });
    const invite = await f.api('owner', '/' + c.group.id + '/invite', { maxUses: 100 });
    const out = await Promise.allSettled(
      Array.from({ length: 32 }, async (_, i) => {
        await f.init('u' + i);
        return f.api('u' + i, '/join', { code: invite.code });
      }),
    );
    expect(out.filter((r) => r.status === 'fulfilled')).toHaveLength(29);
    expect((await getGroups(f.env, 'owner')).groups[0].memberCount).toBe(30);
  });
  it('expires, consumes, revokes and regenerates invites without plaintext persistence', async () => {
    const f = fixture();
    for (const u of ['owner', 'one', 'two']) await f.init(u);
    const c = await f.api('owner', '', { name: 'Invite' }),
      id = c.group.id;
    const invite = await f.api('owner', '/' + id + '/invite', { expiresDays: 1, maxUses: 1 });
    await expect(f.api('one', '/join', { code: c.invite.code })).rejects.toMatchObject({
      status: 404,
    });
    await f.api('one', '/join', { code: invite.code });
    await expect(f.api('two', '/join', { code: invite.code })).rejects.toMatchObject({
      status: 404,
    });
    const next = await f.api('owner', '/' + id + '/invite', {});
    await f.api('owner', '/' + id + '/invite/revoke');
    await expect(f.api('two', '/join', { code: next.code })).rejects.toMatchObject({ status: 404 });
    const exp = await f.api('owner', '/' + id + '/invite', { expiresDays: 1 });
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 86400001);
    await expect(f.api('two', '/join', { code: exp.code })).rejects.toMatchObject({ status: 404 });
  });
  it('limits malformed join attempts per account and per hashed IP', async () => {
    const f = fixture();
    await f.init('u');
    for (let i = 0; i < 10; i++)
      await expect(f.api('u', '/join', { code: 'bad' })).rejects.toMatchObject({ status: 400 });
    await expect(f.api('u', '/join', { code: 'bad' })).rejects.toMatchObject({ status: 429 });
    for (let i = 0; i < 50; i++)
      await expect(
        f.api('ip' + i, '/join', { code: 'bad' }, 'POST', 'shared'),
      ).rejects.toMatchObject({ status: 400 });
    await expect(f.api('ip51', '/join', { code: 'bad' }, 'POST', 'shared')).rejects.toMatchObject({
      status: 429,
    });
  });
  it('supports approvals, admin boundaries, owner transfer and deletion', async () => {
    const f = fixture();
    for (const u of ['owner', 'admin', 'member', 'pending', 'outsider']) await f.init(u);
    const c = await f.api('owner', '', { name: 'Managed', approveNewMembers: true }),
      id = c.group.id;
    for (const u of ['admin', 'member', 'pending'])
      await f.api(u, '/join', { code: c.invite.code });
    let view = (await getGroups(f.env, 'owner')).groups[0];
    for (const m of view.pending.filter((m: any) => m.name !== 'pending'))
      await f.api('owner', '/' + id + '/approve', { memberId: m.id });
    view = (await getGroups(f.env, 'owner')).groups[0];
    const admin = view.members.find((m: any) => m.name === 'admin'),
      member = view.members.find((m: any) => m.name === 'member');
    await f.api('owner', '/' + id + '/role', { memberId: admin.id, role: 'admin' });
    await expect(f.api('outsider', '/' + id, {}, 'GET')).rejects.toMatchObject({ status: 404 });
    await expect(
      f.api('admin', '/' + id + '/role', { memberId: member.id, role: 'admin' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.api('admin', '/' + id + '/remove', { memberId: view.members[0].id }),
    ).rejects.toMatchObject({ status: 403 });
    await f.api('admin', '/' + id + '/approve', { memberId: view.pending[0].id });
    await f.api('admin', '/' + id + '/remove', { memberId: member.id });
    expect((await getGroups(f.env, 'member')).groups).toHaveLength(0);
    await expect(f.api('owner', '/' + id + '/leave')).rejects.toMatchObject({ status: 409 });
    await f.api('owner', '/' + id + '/transfer', { memberId: admin.id });
    await f.api('owner', '/' + id + '/leave');
    await f.api('admin', '/' + id, {}, 'DELETE');
    await expect(f.api('pending', '/join', { code: c.invite.code })).rejects.toMatchObject({
      status: 404,
    });
    expect((await getGroups(f.env, 'pending')).groups).toHaveLength(0);
  });
  it('enforces transfer ownership quota and lets pending members withdraw their reservation', async () => {
    const f = fixture();
    for (const u of ['owner', 'target', 'pending']) await f.init(u);
    for (let i = 0; i < 3; i++) await f.api('target', '', { name: 'Owned' });
    const c = await f.api('owner', '', { name: 'Transfer', approveNewMembers: true }),
      id = c.group.id;
    await f.api('target', '/join', { code: c.invite.code });
    await f.api('pending', '/join', { code: c.invite.code });
    let view = (await getGroups(f.env, 'owner')).groups[0];
    const target = view.pending.find((m: any) => m.name === 'target');
    await f.api('owner', '/' + id + '/approve', { memberId: target.id });
    await expect(
      f.api('owner', '/' + id + '/transfer', { memberId: target.id }),
    ).rejects.toMatchObject({ status: 409 });
    await f.api('pending', '/' + id + '/leave');
    view = (await getGroups(f.env, 'owner')).groups[0];
    expect(view.pending).toEqual([]);
  });
  it('account cleanup deletes owned groups and drops active and pending membership', async () => {
    const f = fixture();
    for (const u of ['owner', 'other']) await f.init(u);
    const c = await f.api('owner', '', { name: 'Deleted' });
    await f.api('other', '/join', { code: c.invite.code });
    await cleanupGroups(f.env, 'other');
    expect((await getGroups(f.env, 'owner')).groups[0].memberCount).toBe(1);
    await cleanupGroups(f.env, 'owner');
    expect((await getGroups(f.env, 'owner')).groups).toEqual([]);
    await expect(f.api('other', '/join', { code: c.invite.code })).rejects.toMatchObject({
      status: 404,
    });
    await cleanupGroups({} as Env, 'legacy');
  });
});
