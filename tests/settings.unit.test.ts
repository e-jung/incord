import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  settingsDefaults,
  loadSettings,
  migrateSettings,
  serverSettings,
  mergeSettings,
  stampSettings,
} from '../shared/domain/settings';
import { UserDO, settingsRecord, mergeServerSettings, type Env } from '../cloudflare/worker';

describe('shared settings boundary', () => {
  it('uses one default set with an explicit browser timezone and the same evening reminder', () => {
    expect(settingsDefaults().reminderTime).toBe('19:00');
    expect(settingsDefaults('America/Los_Angeles')).toEqual({
      ...settingsDefaults(),
      timeZone: 'America/Los_Angeles',
    });
  });
  it('fills missing fields with zero clocks, preserving legacy revisions and stored choices', () => {
    const loaded = loadSettings({ name: ' Grace ', reminderTime: '09:00', updatedAt: 100 });
    expect(loaded).toMatchObject({
      name: 'Grace',
      reminderTime: '09:00',
      updatedAt: 100,
      fieldUpdatedAt: { name: 100, reminderTime: 100, keySounds: 0, goal: 0 },
    });
    expect(loadSettings({ updatedAt: 100 }).reminderTime).toBe('19:00');
    expect(stampSettings(loaded, loaded, 200)).toEqual(loaded);
    const changed = stampSettings({ ...loaded, keySounds: true }, loaded, 200);
    expect(changed.fieldUpdatedAt).toMatchObject({
      name: 100,
      reminderTime: 100,
      keySounds: 200,
      goal: 0,
    });
  });
  it('migrates all legacy aliases and their clocks only once, stripping retired fields', () => {
    const legacy = {
      displayName: ' Grace ',
      appearance: 'dark',
      weeklyGoal: 5,
      timezone: 'UTC',
      remindersEnabled: true,
      typingMode: 'native',
      peekNoteDismissed: true,
      updatedAt: 20,
      fieldUpdatedAt: {
        displayName: 20,
        appearance: 10,
        weeklyGoal: 8,
        timezone: 7,
        remindersEnabled: 6,
        typingMode: Infinity,
        peekNoteDismissed: Infinity,
      },
    };
    const migrated = migrateSettings(legacy);
    expect(migrated).toEqual({
      name: 'Grace',
      theme: 'dark',
      goal: 5,
      timeZone: 'UTC',
      pushEnabled: true,
      updatedAt: 20,
      fieldUpdatedAt: { name: 20, theme: 10, goal: 8, timeZone: 7, pushEnabled: 6 },
    });
    expect(migrateSettings(migrated)).toEqual(migrated);
    expect(migrateSettings(serverSettings(migrated))).toEqual(migrated);
    expect(settingsRecord(legacy)).toMatchObject({
      name: 'Grace',
      displayName: 'Grace',
      fieldUpdatedAt: { name: 20, displayName: 20 },
    });
  });
  it('resolves contradictory aliases by field clock, with canonical names winning ties', () => {
    expect(
      migrateSettings({
        name: 'Old',
        displayName: 'New',
        updatedAt: 30,
        fieldUpdatedAt: { name: 10, displayName: 30 },
      }),
    ).toMatchObject({ name: 'New', fieldUpdatedAt: { name: 30 } });
    expect(
      migrateSettings({
        name: 'Canonical',
        displayName: 'Alias',
        updatedAt: 30,
        fieldUpdatedAt: { name: 30, displayName: 30 },
      }).name,
    ).toBe('Canonical');
    expect(
      migrateSettings({ name: 'Canonical', updatedAt: 30, fieldUpdatedAt: { displayName: 30 } }),
    ).toMatchObject({ name: 'Canonical', fieldUpdatedAt: { name: 30 } });
  });
  it('merges independent edits identically on client and server without alias clock drift', () => {
    const local = loadSettings({
      name: 'Local',
      theme: 'dark',
      updatedAt: 40,
      fieldUpdatedAt: { name: 40, theme: 10 },
    });
    const remote = {
      displayName: 'Old',
      appearance: 'light',
      updatedAt: 50,
      fieldUpdatedAt: { displayName: 10, appearance: 50 },
    };
    const merged = mergeSettings(local, remote);
    expect(merged).toMatchObject({
      name: 'Local',
      theme: 'light',
      fieldUpdatedAt: { name: 40, theme: 50 },
    });
    expect(mergeSettings(remote, local)).toEqual(merged);
    expect(migrateSettings(mergeServerSettings(serverSettings(local), remote))).toEqual(merged);
    expect(mergeSettings({ updatedAt: 0 }, { name: 'Zero clock', updatedAt: 0 }).name).toBe(
      'Zero clock',
    );
  });
  it('uses a record revision only when the whole field-clock map is absent', () => {
    expect(
      mergeSettings(
        { name: 'Unclocked', updatedAt: 20 },
        { name: 'Clocked', updatedAt: 100, fieldUpdatedAt: {} },
      ).name,
    ).toBe('Unclocked');
    const a = { theme: 'dark', updatedAt: 10 },
      b = { theme: 'light', updatedAt: 10 };
    expect(mergeSettings(a, b)).toEqual(mergeSettings(b, a));
  });
});

function userFixture(stored?: Record<string, unknown>) {
  const db = new DatabaseSync(':memory:');
  const state = {
    id: { toString: () => 'settings-test' },
    storage: {
      sql: {
        exec(query: string, ...args: any[]) {
          const statement = db.prepare(query);
          return statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
        },
      },
      transactionSync: (fn: () => unknown) => fn(),
    },
    blockConcurrencyWhile: (fn: () => unknown) => fn(),
  } as unknown as DurableObjectState;
  const object = new UserDO(state, {
    VAPID_PRIVATE_KEY: 'test-only',
    VAPID_PUBLIC_KEY: 'test-only',
  } as Env);
  db.prepare('INSERT INTO meta VALUES(?,?)').run(
    'profile',
    JSON.stringify({ displayName: 'Profile name' }),
  );
  if (stored) db.prepare('INSERT INTO meta VALUES(?,?)').run('settings', JSON.stringify(stored));
  const call = async (path: string, data: unknown = {}) =>
    (
      await object.fetch(
        new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(data) }),
      )
    ).json<any>();
  return { db, call };
}

describe('existing server settings fallback', () => {
  it('returns 19:00 for absent settings without writing defaults or erasing the profile name', async () => {
    const { db, call } = userFixture();
    const response = await call('/me');
    expect(response.user).toMatchObject({
      displayName: 'Profile name',
      settings: { reminderTime: '19:00', timezone: 'UTC', remindersEnabled: false },
    });
    expect(db.prepare("SELECT value FROM meta WHERE key='settings'").get()).toBeUndefined();
  });
  it.each([undefined, '09:00', '21:30'])(
    'preserves stored reminder %s and does not let unrelated sync reset it',
    async (reminderTime) => {
      const { call } = userFixture({
        remindersEnabled: true,
        timezone: 'UTC',
        updatedAt: 10,
        ...(reminderTime ? { reminderTime } : {}),
      });
      const response = await call('/sync', { settings: { keySounds: true, updatedAt: 20 } });
      expect(response.settings).toMatchObject({
        reminderTime: reminderTime ?? '19:00',
        remindersEnabled: true,
        keySounds: true,
      });
    },
  );
  it('does not replace the browser timezone with an unstored server UTC fallback', async () => {
    const { call } = userFixture();
    const response = await call('/sync', { settings: settingsDefaults('America/Los_Angeles') });
    expect(response.settings).toMatchObject({
      timeZone: 'America/Los_Angeles',
      timezone: 'America/Los_Angeles',
    });
  });
  it('keeps an explicitly blank preference name distinct from a missing one', async () => {
    const { call } = userFixture({ displayName: '', updatedAt: 10 });
    expect((await call('/me')).user.displayName).toBe('Friend');
  });
});

// Exercise the actual cron decision without a push endpoint or network request.
it.each([
  { time: '09:00', stored: undefined, reserved: false },
  { time: '19:00', stored: undefined, reserved: true },
  { time: '19:14', stored: undefined, reserved: true },
  { time: '19:15', stored: undefined, reserved: false },
  { time: '09:00', stored: '09:00', reserved: true },
  { time: '19:00', stored: '09:00', reserved: false },
])(
  'cron honors the chosen/default reminder and quarter-hour window: $time / $stored',
  async ({ time, stored, reserved }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-16T' + time + ':00Z'));
      const { db, call } = userFixture({
        remindersEnabled: true,
        timezone: 'UTC',
        updatedAt: 10,
        ...(stored ? { reminderTime: stored } : {}),
      });
      db.prepare('INSERT INTO items VALUES(?,?,?)').run(
        'due',
        JSON.stringify({ id: 'due', learned: false, updatedAt: 1 }),
        1,
      );
      await call('/push/remind');
      expect(Boolean(db.prepare("SELECT value FROM meta WHERE key='remindedDay'").get())).toBe(
        reserved,
      );
    } finally {
      vi.useRealTimers();
    }
  },
);
