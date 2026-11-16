import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  GroupDO,
  getGroups,
  resolveGroupGoal,
  scheduleGroups,
  dispatchGroupReminders,
} from '../cloudflare/groups';
import { fixture, item } from './groups.fixture';
afterEach(() => vi.restoreAllMocks());
describe('Groups SQLite architecture and bounded fanout', () => {
  it('stores goals/rosters in GroupDO and only indexes in the registry; failed membership installs reserve quota and retry idempotently', async () => {
    const f = fixture();
    for (const uid of ['owner', 'joiner']) await f.init(uid);
    const c = await f.api('owner', '', { name: 'Durable' }),
      id = c.group.id;
    await f.api('owner', '/' + id + '/goal', {
      selection: { kind: 'passage', id: 'psalm-23', translation: 'BSB' },
    });
    const sql = (f.groups.get(id) as any).ctx.storage.sql;
    expect(JSON.parse([...sql.exec('SELECT value FROM group_state')][0].value)).toMatchObject({
      name: 'Durable',
      goal: { title: 'Psalm 23' },
      members: [{ role: 'owner' }],
    });
    const index = JSON.parse(
      [...(f.registry as any).sql.exec('SELECT value FROM groups_registry')][0].value,
    );
    expect(index.goal).toBeUndefined();
    expect(index.name).toBeUndefined();
    expect(index.pendingGroup).toBeUndefined();
    expect(index.members).toHaveLength(1);
    const invite = await f.api('owner', '/' + id + '/invite', { maxUses: 1 });
    f.fault.install = true;
    await expect(f.api('joiner', '/join', { code: invite.code })).rejects.toThrow();
    const reservation = JSON.parse(
      [...(f.registry as any).sql.exec('SELECT value FROM groups_registry')][0].value,
    );
    expect(reservation.members).toHaveLength(2);
    expect(reservation.pendingGroup).toBeDefined();
    await expect(getGroups(f.env, 'owner')).rejects.toThrow();
    f.fault.install = false;
    const retried = await f.api('joiner', '/join', { code: invite.code });
    expect(retried.group.memberCount).toBe(2);
    expect(
      JSON.parse([...(f.registry as any).sql.exec('SELECT value FROM groups_registry')][0].value)
        .pendingGroup,
    ).toBeUndefined();
    const target = retried.group.members.find((m: any) => m.self);
    f.fault.install = true;
    await expect(f.api('owner', '/' + id + '/remove', { memberId: target.id })).rejects.toThrow();
    expect((await getGroups(f.env, 'joiner')).groups).toEqual([]);
    f.fault.install = false;
    expect((await getGroups(f.env, 'owner')).groups[0].memberCount).toBe(1);
  });
  it('projects five full 30-member groups with six root calls and no invocation over 32, including Sunday cron', async () => {
    const f = fixture(),
      ids = [];
    for (let i = 0; i < 5; i++) {
      await f.init('host' + i, { remindersEnabled: true, timezone: 'UTC' });
      const c = await f.api('host' + i, '', { name: 'Full ' + i });
      ids.push(c.group.id);
      const invite = await f.api('host' + i, '/' + c.group.id + '/invite', { maxUses: 100 });
      for (let j = 0; j < 29; j++) {
        const uid = j === 0 ? 'reader' : 'member-' + i + '-' + j;
        await f.init(uid, { remindersEnabled: true, timezone: 'UTC' });
        await f.api(uid, '/join', { code: invite.code });
      }
    }
    f.invocations.length = 0;
    f.root.calls = 0;
    const result = await getGroups(f.env, 'reader');
    expect(result.groups).toHaveLength(5);
    expect(result.groups.every((g) => g.members.length === 30)).toBe(true);
    expect(f.root.calls).toBe(6);
    expect(Math.max(...f.invocations.map((i) => i.calls))).toBe(30);
    f.invocations.length = 0;
    f.root.calls = 0;
    await scheduleGroups(f.env, new Date('2026-11-15T18:00:00Z'));
    expect(f.root.calls).toBe(2);
    expect(Math.max(...f.invocations.map((i) => i.calls))).toBe(32);
    for (const id of ids)
      expect([
        ...(f.groups.get(id) as any).ctx.storage.sql.exec('SELECT id FROM deliveries'),
      ]).toHaveLength(30);
    f.invocations.length = 0;
    f.root.calls = 0;
    Object.assign(f.env, { VAPID_PUBLIC_KEY: 'test', VAPID_PRIVATE_KEY: 'test' });
    await dispatchGroupReminders(
      f.env,
      Array.from({ length: 200 }, () => 'reader'),
    );
    expect(f.root.calls).toBe(1);
    expect(Math.max(...f.invocations.map((i) => i.calls))).toBeLessThanOrEqual(30);
  }, 15000); // 150 SQLite-backed members plus cron fanout under coverage.
  it('bounds projection work even when pending requests exceed the active roster cap', async () => {
    const f = fixture();
    await f.init('owner');
    const c = await f.api('owner', '', { name: 'Approvals', approveNewMembers: true });
    const invite = await f.api('owner', '/' + c.group.id + '/invite', { maxUses: 100 });
    for (let i = 0; i < 35; i++) {
      await f.init('pending' + i);
      await f.api('pending' + i, '/join', { code: invite.code });
    }
    f.invocations.length = 0;
    const out = await getGroups(f.env, 'owner');
    expect(out.groups[0].pending).toHaveLength(35);
    expect(out.groups[0].members).toHaveLength(1);
    expect(Math.max(...f.invocations.map((i) => i.calls))).toBeLessThanOrEqual(30);
  });
  it('splits large cron group lists into bounded branches', async () => {
    const f = fixture();
    for (let i = 0; i < 45; i++) {
      await f.init('owner' + i);
      await f.api('owner' + i, '', { name: 'Fanout' });
    }
    f.invocations.length = 0;
    await scheduleGroups(f.env, new Date('2026-11-15T18:00:00Z'));
    expect(Math.max(...f.invocations.map((i) => i.calls))).toBeLessThanOrEqual(20);
    expect(f.invocations.filter((i) => i.path === '/schedule')).toHaveLength(45);
  });
  it('summarizes practiced members, not practice days, and aggregate shared-goal progress without names', async () => {
    const f = fixture(),
      now = new Date('2026-11-15T18:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(+now);
    for (const uid of ['owner', 'other', 'third'])
      await f.init(uid, { remindersEnabled: true, timezone: 'UTC' });
    const c = await f.api('owner', '', { name: 'Encouragement' }),
      id = c.group.id;
    for (const uid of ['other', 'third']) await f.api(uid, '/join', { code: c.invite.code });
    await f.api('owner', '/' + id + '/goal', {
      selection: { kind: 'passage', id: 'psalm-23', translation: 'BSB' },
    });
    for (const uid of ['owner', 'other'])
      await f.callUser(uid, '/sync', {
        items: [item('bsb-psa-23-1--bsb-psa-23-6', { learned: true })],
        events: [
          { id: uid + '-1', at: '2026-11-14T18:00:00Z' },
          { id: uid + '-2', at: '2026-11-15T17:00:00Z' },
        ],
      });
    await scheduleGroups(f.env, now);
    expect(f.pushBodies).toHaveLength(3);
    for (const push of f.pushBodies) {
      expect(push.body).toContain('2 practiced · Psalm 23: 2 of 3 learned');
      expect(push.body).not.toMatch(/owner|other|third|4 practiced/);
    }
    await scheduleGroups(f.env, now);
    expect(f.pushBodies).toHaveLength(3);
  });
  it.each(['WEB', 'ESV'])(
    'keeps WSC starter canonical and unlabelled when Bible translation is %s',
    async (translation) => {
      const f = fixture();
      const { goal, items } = await resolveGroupGoal(f.env, {
        kind: 'starter',
        id: 'wsc-start',
        translation,
      });
      expect(goal.itemIds).toEqual(Array.from({ length: 12 }, (_, i) => 'wsc-' + (i + 1)));
      expect(items.every((i) => i.translation === '' && i.collection === 'wsc')).toBe(true);
    },
  );
});
