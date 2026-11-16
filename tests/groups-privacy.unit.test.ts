import { afterEach, describe, it, expect, vi } from 'vitest';
import { settingsRecord, b64 } from '../cloudflare/worker';
import { getGroups, projectGroupMember, weeklyWindow, scheduleGroups } from '../cloudflare/groups';
import { fixture, item } from './groups.fixture';
afterEach(() => vi.restoreAllMocks());
describe('privacy, additions and encouragement', () => {
  it.each([
    ['esv-jhn-3-16', undefined, 'John 3:16', 'John 3:16'],
    ['custom', 'esv', 'John 3:16', 'John 3:16'],
    ['ESV-jhn-3-16', undefined, undefined, 'ESV passage'],
    ['custom', 'esv', 'For God so loved the world', 'ESV passage'],
  ])(
    'sanitizes ESV titles identified by id or lowercase label: %s/%s',
    (id, translation, reference, title) => {
      const state = {
        settings: {},
        items: [
          item(id!, {
            translation,
            reference,
            title: 'For God so loved the world',
            text: 'Quotation must stay private',
          }),
        ],
      };
      const member = {
        uid: 'owner',
        id: 'public-member',
        role: 'owner' as const,
        pending: false,
        requestedAt: 1,
        weekly: true,
      };
      const projected = projectGroupMember(state, member, 'owner', null);
      expect(projected.titles).toEqual([{ title, translation: 'ESV', learned: false }]);
      expect(JSON.stringify(projected)).not.toMatch(
        /For God so loved the world|Quotation must stay private/,
      );
    },
  );
  it('reflects title privacy immediately in every projection and uses legacy aliases/defaults', async () => {
    const f = fixture();
    await f.init('owner', { name: 'Grace', goal: 5 });
    await f.callUser('owner', '/sync', {
      items: [item('one', { learned: false }), item('two', { learned: true })],
      events: [{ id: 'private-log', at: new Date().toISOString(), grade: 1, text: 'private' }],
    });
    const c = await f.api('owner', '', { name: 'Privacy' });
    expect(c.group.members[0]).toMatchObject({
      name: 'Grace',
      weeklyGoal: 5,
      titles: [{ learned: false }, { learned: true }],
    });
    await f.callUser('owner', '/sync', { settings: { groupShareTitles: false, updatedAt: 2 } });
    const out = await getGroups(f.env, 'owner');
    expect(out.groups[0].members[0].titles).toBeUndefined();
    for (const secret of ['Private text', 'private-log', 'grade', 'uid', 'email'])
      expect(JSON.stringify(out)).not.toContain(secret);
    expect(() => settingsRecord({ updatedAt: 1, groupShareTitles: 'false' })).toThrow();
    expect(() => settingsRecord({ updatedAt: 1, groupReceivePrayer: 0 })).toThrow();
  });
  it('adds canonical goals through the shared insert merge, preserving concurrent local progress and ESV caps', async () => {
    const f = fixture();
    await f.init('owner');
    const c = await f.api('owner', '', { name: 'Goal' }),
      id = c.group.id;
    await f.api('owner', '/' + id + '/goal', {
      selection: { kind: 'passage', id: 'psalm-23', translation: 'BSB' },
    });
    const local = item('bsb-psa-23-1--bsb-psa-23-6', {
      title: 'Offline edit',
      step: 3,
      updatedAt: Date.now() - 1000,
    });
    const added = await f.api('owner', '/' + id + '/goal/add');
    expect(added.results[0].status).toBe('added');
    expect((await f.callUser('owner', '/sync')).items[0].origin).toBe('group');
    await f.callUser('owner', '/sync', { items: [local] });
    await f.api('owner', '/' + id + '/goal/add');
    expect((await f.callUser('owner', '/sync')).items[0]).toEqual(local);
    const esv = item('esv-jhn-3-16', {
      translation: 'ESV',
      reference: 'John 3:16',
      esvVerseKeys: ['jhn-3-16'],
      text: 'forbidden',
    });
    await f.callUser('owner', '/groups/add', { items: [esv] });
    expect((await f.callUser('owner', '/sync')).items.find((i: any) => i.id === esv.id).text).toBe(
      '',
    );
    const invalid = item('esv-jud-1-1--esv-jud-1-20', {
      translation: 'ESV',
      reference: 'Jude 1:1-20',
    });
    expect((await f.callUser('owner', '/groups/add', { items: [invalid] })).results[0].status).toBe(
      'invalid reference',
    );
  });
  it('reserves prayer once per ordered pair/day and prevents self/nonmember prayers', async () => {
    const f = fixture();
    await f.init('owner');
    await f.init('other', { groupReceivePrayer: false });
    const c = await f.api('owner', '', { name: 'Prayer' }),
      id = c.group.id;
    const joined = await f.api('other', '/join', { code: c.invite.code }),
      target = joined.group.members.find((m: any) => m.self).id;
    expect(await f.api('owner', '/' + id + '/pray', { memberId: target })).toEqual({ ok: true });
    expect(await f.api('owner', '/' + id + '/pray', { memberId: target })).toEqual({
      ok: true,
      alreadySent: true,
    });
    await expect(f.api('other', '/' + id + '/pray', { memberId: target })).rejects.toThrow();
    await expect(f.api('owner', '/' + id + '/pray', { memberId: 'missing' })).rejects.toThrow();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 86400000);
    expect(await f.api('owner', '/' + id + '/pray', { memberId: target })).toEqual({ ok: true });
  });
  it('deduplicates the same ordered pair across two groups, including concurrent requests', async () => {
    const f = fixture();
    for (const uid of ['sender', 'recipient', 'third']) await f.init(uid);
    const groups = [];
    for (const name of ['First', 'Second']) {
      const c = await f.api('sender', '', { name });
      const joined = await f.api('recipient', '/join', { code: c.invite.code });
      groups.push({
        id: c.group.id,
        target: joined.group.members.find((m: any) => m.self).id,
        sender: c.group.members[0].id,
        code: c.invite.code,
      });
    }
    expect(groups[0].target).not.toBe(groups[1].target);
    const results = await Promise.all(
      groups.map((g) => f.api('sender', '/' + g.id + '/pray', { memberId: g.target })),
    );
    expect(results.filter((r) => !r.alreadySent)).toEqual([{ ok: true }]);
    expect(results.filter((r) => r.alreadySent)).toEqual([{ ok: true, alreadySent: true }]);
    const g = groups[1];
    expect(await f.api('recipient', '/' + g.id + '/pray', { memberId: g.sender })).toEqual({
      ok: true,
    });
    await f.api('third', '/join', { code: g.code });
    expect(await f.api('third', '/' + g.id + '/pray', { memberId: g.target })).toEqual({
      ok: true,
    });
    expect(await f.api('sender', '/' + g.id + '/pray', { memberId: g.target })).toEqual({
      ok: true,
      alreadySent: true,
    });
  });
  it('retains prayer reservations after either member rejoins and resets at UTC midnight', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-13T23:59:59Z'));
    const f = fixture();
    for (const uid of ['host', 'sender', 'recipient']) await f.init(uid);
    const c = await f.api('host', '', { name: 'Rejoin' }),
      id = c.group.id;
    for (const uid of ['sender', 'recipient']) await f.api(uid, '/join', { code: c.invite.code });
    const target = () =>
      getGroups(f.env, 'sender').then(
        (out) => out.groups[0].members.find((m: any) => m.name === 'recipient').id,
      );
    const firstTarget = await target();
    expect(await f.api('sender', '/' + id + '/pray', { memberId: firstTarget })).toEqual({
      ok: true,
    });
    await f.api('recipient', '/' + id + '/leave');
    await expect(f.api('sender', '/' + id + '/pray', { memberId: firstTarget })).rejects.toThrow();
    await f.api('recipient', '/join', { code: c.invite.code });
    const newTarget = await target();
    expect(newTarget).not.toBe(firstTarget);
    expect(await f.api('sender', '/' + id + '/pray', { memberId: newTarget })).toEqual({
      ok: true,
      alreadySent: true,
    });
    await f.api('sender', '/' + id + '/leave');
    await f.api('sender', '/join', { code: c.invite.code });
    expect(await f.api('sender', '/' + id + '/pray', { memberId: newTarget })).toEqual({
      ok: true,
      alreadySent: true,
    });
    clock.mockReturnValue(Date.parse('2026-11-14T00:00:00Z'));
    expect(await f.api('sender', '/' + id + '/pray', { memberId: newTarget })).toEqual({
      ok: true,
    });
    expect(await f.api('sender', '/' + id + '/pray', { memberId: newTarget })).toEqual({
      ok: true,
      alreadySent: true,
    });
  });
  it('honors prayer recipient opt-out and push-disabled settings before encrypted delivery', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-13T12:00:00Z'));
    const f = fixture();
    await f.init('recipient', { groupReceivePrayer: false, remindersEnabled: true });
    await f.init('sender', { name: 'Grace' });
    const c = await f.api('sender', '', { name: 'Prayer' }),
      joined = await f.api('recipient', '/join', { code: c.invite.code });
    const pray = () =>
      f.api('sender', '/' + c.group.id + '/pray', {
        memberId: joined.group.members.find((m: any) => m.self).id,
      });
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
    await f.callUser('recipient', '/push/subscribe', {
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/groups-test',
        keys: {
          p256dh: b64(new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey))),
          auth: b64(crypto.getRandomValues(new Uint8Array(16))),
        },
      },
    });
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));
    expect(await pray()).toEqual({ ok: true });
    expect(await pray()).toEqual({ ok: true, alreadySent: true });
    expect(network).not.toHaveBeenCalled();
    await f.callUser('recipient', '/sync', {
      settings: { updatedAt: 2, groupReceivePrayer: true, remindersEnabled: false },
    });
    expect(await pray()).toEqual({ ok: true, alreadySent: true });
    clock.mockReturnValue(Date.parse('2026-11-14T12:00:00Z'));
    expect(await pray()).toEqual({ ok: true });
    expect(network).not.toHaveBeenCalled();
    await f.callUser('recipient', '/sync', { settings: { updatedAt: 3, remindersEnabled: true } });
    expect(await pray()).toEqual({ ok: true, alreadySent: true });
    clock.mockReturnValue(Date.parse('2026-11-15T12:00:00Z'));
    expect(await pray()).toEqual({ ok: true });
    expect(await pray()).toEqual({ ok: true, alreadySent: true });
    expect(network).toHaveBeenCalledOnce();
    const init = network.mock.calls[0][1]!;
    expect(new Headers(init.headers).get('Content-Encoding')).toBe('aes128gcm');
    expect(new TextDecoder().decode(init.body as Uint8Array)).not.toContain(
      'Grace is praying for you',
    );
  });
  it.each([
    ['2026-03-09T01:00:00Z', true],
    ['2026-11-02T02:14:00Z', true],
    ['2026-11-02T02:15:00Z', false],
    ['2026-11-01T18:00:00Z', false],
  ])('uses local Sunday 18:00 windows across DST: %s', (iso, expected) => {
    expect(weeklyWindow(new Date(iso as string), 'America/Los_Angeles')).toBe(expected);
  });
  it('does not resend a weekly reminder when a member leaves and rejoins on the same local Sunday', async () => {
    const f = fixture();
    for (const uid of ['owner', 'other'])
      await f.init(uid, { remindersEnabled: true, timezone: 'America/Los_Angeles' });
    const c = await f.api('owner', '', { name: 'Weekly rejoin' }),
      id = c.group.id;
    const joined = await f.api('other', '/join', { code: c.invite.code }),
      oldMember = joined.group.members.find((m: any) => m.self).id;
    const now = new Date('2026-11-16T02:00:00Z');
    await scheduleGroups(f.env, now);
    expect(f.pushBodies).toHaveLength(2);
    await f.api('other', '/' + id + '/leave');
    const rejoined = await f.api('other', '/join', { code: c.invite.code });
    expect(rejoined.group.members.find((m: any) => m.self).id).not.toBe(oldMember);
    await scheduleGroups(f.env, now);
    expect(f.pushBodies).toHaveLength(2);
    await scheduleGroups(f.env, new Date('2026-11-23T02:00:00Z'));
    expect(f.pushBodies).toHaveLength(4);
  });
  it('weekly scheduling reserves once per member/local Sunday and skips small groups, opt-out and push-disabled', async () => {
    const f = fixture();
    for (const u of ['owner', 'other', 'disabled'])
      await f.init(u, { remindersEnabled: u !== 'disabled', timezone: 'America/Los_Angeles' });
    const c = await f.api('owner', '', { name: 'Weekly' }),
      id = c.group.id;
    const now = new Date('2026-11-16T02:00:00Z');
    await scheduleGroups(f.env, now);
    expect([
      ...(f.groups.get(id) as any).ctx.storage.sql.exec('SELECT id FROM deliveries'),
    ]).toHaveLength(0);
    await f.api('other', '/join', { code: c.invite.code });
    await f.api('disabled', '/join', { code: c.invite.code });
    await f.api('other', '/' + id + '/weekly', { enabled: false });
    await scheduleGroups(f.env, now);
    const object = f.groups.get(id) as any;
    expect([...object.ctx.storage.sql.exec('SELECT id FROM deliveries')]).toHaveLength(1);
    await scheduleGroups(f.env, now);
    expect([...object.ctx.storage.sql.exec('SELECT id FROM deliveries')]).toHaveLength(1);
  });
});
