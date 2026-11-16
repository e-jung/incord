import { describe, it, expect } from 'vitest';
import { mergeItems, type Item } from './store';
const item = (id: string, updatedAt: number, title: string, deleted = false): Item => ({
  id,
  title,
  text: 'Grace',
  collection: 'personal',
  step: 1,
  learned: false,
  due: '2026-01-01',
  updatedAt,
  deleted,
});
describe('offline reconciliation', () => {
  it('retains local edits newer than a stale server snapshot', () => {
    const a = item('a', 10, 'new');
    expect(mergeItems([a], [item('a', 9, 'old')])).toEqual([a]);
  });
  it('merges unrelated items without losing queued local additions', () => {
    const a = item('a', 1, 'a'),
      b = item('b', 1, 'b');
    expect(mergeItems([a], [b])).toEqual([a, b]);
  });
  it('converges equal timestamp conflicts in either arrival order', () => {
    const a = item('a', 10, 'a'),
      z = item('a', 10, 'z');
    expect(mergeItems([a], [z])).toEqual([z]);
    expect(mergeItems([z], [a])).toEqual([z]);
  });
  it('retains tombstones so deleted items cannot be resurrected by stale clients', () => {
    const dead = item('a', 20, 'Grace', true);
    expect(mergeItems([dead], [item('a', 10, 'Grace')])).toEqual([dead]);
    expect(mergeItems([item('a', 10, 'Grace')], [dead])).toEqual([dead]);
  });
});

import {
  addItems,
  findLiveItem,
  sortItems,
  stampSettings,
  mergeSettings,
  defaults,
  emptyState,
  installReconnectSync,
} from './store';
import { vi, afterEach } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
describe('QA store regressions', () => {
  it('P0-2 revives one tombstone and resets all progress', () => {
    const old = {
      ...item('a', 20, 'John 3:16', true),
      step: 4,
      learned: true,
      card: { due: 'old' },
      learnedAt: 'old',
    };
    const items = addItems([old], [item('a', 10, 'John 3:16')], undefined, 15);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ step: 1, learned: false, deleted: false, updatedAt: 21 });
    expect(items[0].card).toBeUndefined();
    expect(findLiveItem([old], 'a')).toBeUndefined();
    expect(findLiveItem(items, 'a')).toBe(items[0]);
    expect(addItems(items, [old])).toHaveLength(1);
  });
  it('P0-2 repairs legacy duplicates using highest revision even in local input', () => {
    expect(mergeItems([item('a', 30, 'new'), item('a', 10, 'old')], [])[0].title).toBe('new');
  });
  it('P1-18 does not stamp settings for practice-only saves', () => {
    const before = { ...defaults, updatedAt: 10 };
    expect(stampSettings({ ...before, updatedAt: 100 }, before, 100).updatedAt).toBe(10);
  });
  it('P1-18 concurrent settings edits merge per field and converge', () => {
    const before = { ...defaults, updatedAt: 10 };
    const a = stampSettings({ ...before, name: ' Grace ' }, before, 20),
      b = stampSettings({ ...before, theme: 'dark' }, before, 30);
    expect(a.name).toBe('Grace');
    expect(a.fieldUpdatedAt?.name).toBe(20);
    expect(mergeSettings(a, b)).toMatchObject({ name: 'Grace', theme: 'dark' });
    expect(mergeSettings(b, a)).toEqual(mergeSettings(a, b));
  });
  it('P1-18 preserves incoming remote clocks on persistence', () => {
    const before = { ...defaults, updatedAt: 10 };
    const next = { ...before, name: 'Grace', updatedAt: 20, fieldUpdatedAt: { name: 20 } };
    expect(stampSettings(next, before, 100).fieldUpdatedAt?.name).toBe(20);
  });
  it('P1-19 fresh account state contains no previous identity or practice', () => {
    expect(emptyState()).toMatchObject({ items: [], events: [], queue: [], account: null });
    const a = emptyState();
    a.settings.days.push('test');
    expect(emptyState().settings.days).toEqual([]);
  });
  it('P2-20 sorts scripture canonically and document questions numerically', () => {
    const items = ['Romans 3:23', 'John 3:16', 'Psalm 23:2', 'Psalm 23:1', 'Q12', 'Q2'].map(
      (title, n) => ({
        ...item(String(n), 1, title),
        collection: 'bible',
        number: n === 4 ? 12 : n === 5 ? 2 : undefined,
      }),
    );
    expect(sortItems(items).map((x) => x.title)).toEqual([
      'Psalm 23:1',
      'Psalm 23:2',
      'John 3:16',
      'Romans 3:23',
      'Q2',
      'Q12',
    ]);
  });
  it('P0-3 retries on reconnect/focus/visibility even without initial config', () => {
    const win = new EventTarget(),
      doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    const sync = vi.fn(),
      cleanup = installReconnectSync(sync);
    win.dispatchEvent(new Event('online'));
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sync).toHaveBeenCalledTimes(2);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sync).toHaveBeenCalledTimes(3);
    cleanup();
    win.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(3);
  });
});

import { openStore, persist, cacheAccount, clearStore } from './store';
describe('P0-3 / P1-19 IndexedDB account boundary', () => {
  it('round-trips cached identity offline and clears all account data on confirmed signout', async () => {
    let saved: any;
    const database = {
      transaction: () => {
        const tx: any = {
          objectStore: () => ({
            get: () => {
              const request: any = {};
              queueMicrotask(() => {
                request.result = structuredClone(saved);
                request.onsuccess();
              });
              return request;
            },
            put: (value: any) => {
              saved = structuredClone(value);
            },
          }),
        };
        queueMicrotask(() => tx.oncomplete?.());
        return tx;
      },
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: any = { result: database };
        queueMicrotask(() => request.onsuccess());
        return request;
      },
    });
    const state = await openStore();
    state.items.push(item('a', 1, 'John 3:16'));
    state.events.push({ id: 'review', itemId: 'a', at: 'now', slips: 0, hidden: 0, grade: 'Good' });
    state.settings.name = 'Grace';
    await cacheAccount(state, { id: 'account-a', displayName: 'Grace' });
    const offline = await openStore();
    expect(offline.account?.id).toBe('account-a');
    expect(offline.items).toHaveLength(1);
    expect(offline.settings.fieldUpdatedAt?.name).toBeGreaterThan(0);
    const cleared = await clearStore();
    expect(cleared).toMatchObject({ items: [], events: [], queue: [], account: null });
    expect(await openStore()).toEqual(cleared);
    const local = await openStore();
    local.settings.name = 'Local';
    const settings = await persist(local);
    expect(settings.fieldUpdatedAt?.name).toBeGreaterThan(0);
  });
});

import { documents } from './content';
import { dailyPlan } from './daily';
import { installQueueRetry } from './store';
describe('QA2 canonical source order and queue backoff', () => {
  for (const id of ['wsc', 'heidelberg'])
    it(`${id} starts with Q1, Q2, Q3 regardless of insertion/title`, () => {
      const source = documents.find((d) => d.id === id)!;
      const input = addItems([], source.items.slice(0, 12).reverse(), id, 1);
      expect(
        sortItems(input)
          .slice(0, 3)
          .map((i) => i.id),
      ).toEqual([`${id}-1`, `${id}-2`, `${id}-3`]);
      expect(dailyPlan(input, [], '2026-11-13').map((i) => i.id)).toEqual([
        `${id}-1`,
        `${id}-2`,
        `${id}-3`,
      ]);
    });
  it('own text uses creation time even when its title looks like Scripture', () => {
    const a = { ...item('a', 1, 'John 3:16'), createdAt: '2026-11-13T01:00:00Z' },
      b = { ...item('b', 1, 'Genesis 1:1'), createdAt: '2026-11-13T02:00:00Z' };
    expect(sortItems([b, a]).map((i) => i.id)).toEqual(['a', 'b']);
  });
  it('orders reviews by due time then canonical source key', () => {
    const input = addItems([], documents[0].items.slice(0, 3), undefined, 1).map((i, n) => ({
      ...i,
      learned: true,
      due: n === 0 ? '2026-01-02' : '2026-01-01',
    }));
    expect(dailyPlan(input, [], '2026-11-13').map((i) => i.id)).toEqual([
      'wsc-2',
      'wsc-3',
      'wsc-1',
    ]);
  });
  it('retries after 5s, 15s, 60s then every five minutes without browser events and stops when empty', async () => {
    vi.useFakeTimers();
    let pending = true;
    const sync = vi.fn(async () => {});
    const retry = installQueueRetry(() => pending, sync);
    retry.update();
    for (const delay of [5000, 15000, 60000, 300000, 300000]) {
      const count = sync.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sync).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(sync).toHaveBeenCalledTimes(count + 1);
    }
    pending = false;
    retry.update();
    await vi.advanceTimersByTimeAsync(600000);
    expect(sync).toHaveBeenCalledTimes(5);
    retry.stop();
    vi.useRealTimers();
  });
});

it('upgrading stored settings never timestamps new preference defaults as user edits', async () => {
  let saved: any = { ...emptyState(), settings: { ...defaults, updatedAt: 10 } };
  delete saved.settings.groupShareTitles;
  delete saved.settings.groupReceivePrayer;
  delete saved.settings.keySounds;
  delete saved.settings.haptics;
  delete saved.settings.newPerDay;
  delete saved.settings.defaultTranslation;
  const database = {
    transaction: () => {
      const tx: any = {
        objectStore: () => ({
          get: () => {
            const request: any = {};
            queueMicrotask(() => {
              request.result = structuredClone(saved);
              request.onsuccess();
            });
            return request;
          },
          put: (value: any) => {
            saved = structuredClone(value);
          },
        }),
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: any = { result: database };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  });
  const state = await openStore();
  await persist(state);
  expect(state.settings).toMatchObject({
    groupShareTitles: true,
    groupReceivePrayer: true,
    defaultTranslation: 'BSB',
    keySounds: false,
    haptics: false,
    updatedAt: 10,
    fieldUpdatedAt: {
      groupShareTitles: 0,
      groupReceivePrayer: 0,
      defaultTranslation: 0,
      keySounds: 0,
      haptics: 0,
      newPerDay: 0,
      name: 10,
    },
  });
  const remote = {
    ...defaults,
    keySounds: true,
    haptics: true,
    updatedAt: 20,
    fieldUpdatedAt: { keySounds: 20, haptics: 20 },
  };
  const merged = mergeSettings(state.settings, remote);
  expect(merged).toMatchObject({ keySounds: true, haptics: true });
  expect(stampSettings({ ...merged, keySounds: false }, merged, 30).fieldUpdatedAt?.keySounds).toBe(
    30,
  );
});

it('group privacy choices sync per field and are not overwritten by another device’s defaults', () => {
  const before = { ...defaults, updatedAt: 10 };
  const privateDevice = stampSettings({ ...before, groupShareTitles: false }, before, 20);
  const quietDevice = stampSettings({ ...before, groupReceivePrayer: false }, before, 30);
  const merged = mergeSettings(privateDevice, quietDevice);
  expect(merged).toMatchObject({
    groupShareTitles: false,
    groupReceivePrayer: false,
    fieldUpdatedAt: { groupShareTitles: 20, groupReceivePrayer: 30 },
  });
  expect(mergeSettings(quietDevice, privateDevice)).toEqual(merged);
  expect(
    mergeSettings(merged, {
      ...defaults,
      updatedAt: 99,
      fieldUpdatedAt: { groupShareTitles: 0, groupReceivePrayer: 0 },
    }),
  ).toMatchObject({ groupShareTitles: false, groupReceivePrayer: false });
});

it('ignores removed typing preferences and clocks while preserving independent settings edits', () => {
  const legacy = {
    ...defaults,
    typingMode: 'native',
    peekNoteDismissed: true,
    keySounds: true,
    updatedAt: 20,
    fieldUpdatedAt: {
      typingMode: 999999999999999,
      peekNoteDismissed: 999999999999999,
      keySounds: 20,
    },
  };
  for (const value of [
    stampSettings(legacy, defaults, 30),
    mergeSettings(defaults, legacy),
    mergeSettings(legacy, {
      ...defaults,
      haptics: true,
      updatedAt: 30,
      fieldUpdatedAt: { haptics: 30 },
    }),
  ]) {
    expect(value).not.toHaveProperty('typingMode');
    expect(value.fieldUpdatedAt).not.toHaveProperty('typingMode');
    expect(value).not.toHaveProperty('peekNoteDismissed');
    expect(value.fieldUpdatedAt).not.toHaveProperty('peekNoteDismissed');
    expect(value.keySounds).toBe(true);
  }
});
