import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupReference, fetchEsvText, esvAttribution } from './content';
import {
  addItems,
  mergeItems,
  api,
  ensureItemText,
  syncPayload,
  persist,
  emptyState,
  type Item,
} from './store';
import { assertEsvLimit, esvReferenceKeys, stripEsvText, ESV_OFFLINE_MESSAGE } from '../shared/esv';
const exact = '  “For God so loved the world…”\n\n';
const esv = (reference = 'John 3:16', id = 'esv-jhn-3-16'): Item => ({
  id,
  title: reference,
  reference,
  translation: 'ESV',
  esvVerseKeys: esvReferenceKeys(reference),
  text: exact,
  collection: 'bible',
  step: 1,
  learned: false,
  due: 'now',
  updatedAt: 1,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('ESV device-only content', () => {
  it('resolves a canonical reference and preserves exact publisher whitespace/typography', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes('content/')
        ? new Response(
            JSON.stringify({ book: 'John', chapters: { 3: { 16: 'BSB text', 17: 'BSB text' } } }),
          )
        : new Response(exact),
    );
    vi.stubGlobal('fetch', fetch);
    const found = await lookupReference('Jn 3:16-17', 'ESV');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      reference: 'John 3:16–17',
      esvVerseKeys: ['jhn-3-16', 'jhn-3-17'],
      text: '',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await ensureItemText(found[0] as Item);
    expect(found[0].text).toBe(exact);
    expect(String(fetch.mock.calls.at(-1)?.[0])).toBe('/api/esv?q=John%203%3A16%E2%80%9317');
  });
  it('strips quotations and optional headings on sync, never mutating the local item', async () => {
    const item = { ...esv(), heading: 'not metadata' };
    const payload = { items: [item], events: [], settings: { theme: 'dark' } };
    const fetch = vi.fn(async () => Response.json({ items: [] }));
    vi.stubGlobal('fetch', fetch);
    await api('/sync', payload);
    expect(JSON.parse((fetch.mock.calls[0] as any)[1].body).items[0]).toMatchObject({
      text: '',
      reference: 'John 3:16',
    });
    expect((syncPayload(payload) as any).items[0].heading).toBeUndefined();
    expect(item.text).toBe(exact);
    expect(item.heading).toBe('not metadata');
  });
  it('recognizes ESV ids even if a malicious payload omits its translation', () => {
    expect(stripEsvText({ ...esv(), translation: undefined }).text).toBe('');
  });
  it('keeps device text on newer metadata sync, but never accepts server text', () => {
    expect(
      mergeItems([esv()], [{ ...esv(), updatedAt: 2, text: 'server text', step: 3 }])[0],
    ).toMatchObject({ text: exact, step: 3 });
    expect(mergeItems([], [esv()])[0].text).toBe('');
  });
  it('purges a deleted quotation instead of retaining it as an uncounted cache', () => {
    expect(mergeItems([esv()], [{ ...esv(), deleted: true, updatedAt: 2 }])[0].text).toBe('');
  });
  it('does not reuse cached text for changed reference metadata', () => {
    expect(mergeItems([esv()], [{ ...esv('John 3:17'), updatedAt: 2 }])[0].text).toBe('');
  });
  it('refetches missing text once on demand without changing synced revision', async () => {
    const fetch = vi.fn(async () => new Response(exact));
    vi.stubGlobal('fetch', fetch);
    const item = { ...esv(), text: '' };
    await ensureItemText(item);
    await ensureItemText(item);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(item).toMatchObject({ text: exact, updatedAt: 1 });
  });
  it('shows explicit offline guidance without a fetch; cached text still works offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(ensureItemText({ ...esv(), text: '' })).rejects.toThrow(ESV_OFFLINE_MESSAGE);
    expect(await ensureItemText(esv())).toMatchObject({ text: exact });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('handles unavailable network, API throttling and empty text', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('network'))
        .mockResolvedValueOnce(Response.json({ error: 'Wait an hour' }, { status: 429 }))
        .mockResolvedValueOnce(new Response('  ')),
    );
    await expect(fetchEsvText('John 3:16')).rejects.toThrow(ESV_OFFLINE_MESSAGE);
    await expect(fetchEsvText('John 3:16')).rejects.toThrow('Wait an hour');
    await expect(fetchEsvText('John 3:16')).rejects.toThrow(ESV_OFFLINE_MESSAGE);
  });
  it('exports verified publisher notice and required quotation short form', () => {
    expect(esvAttribution.short).toBe('(ESV)');
    expect(esvAttribution.url).toBe('https://www.esv.org');
    expect(esvAttribution.copyright).toContain('© 2001 by Crossway');
    expect(esvAttribution.copyright).toContain('Creative Commons');
  });
});
describe('ESV verse cap', () => {
  const fiveHundred = () => {
    const list: Item[] = [];
    let count = 0;
    for (let n = 1; count < 500; n++) {
      const full = esvReferenceKeys(`Psalm ${n}`);
      const take = Math.min(full.length, 500 - count);
      list.push(esv(`Psalm ${n}:1-${take}`, `esv-psa-${n}`));
      count += take;
    }
    expect(count).toBe(500);
    return list;
  };
  it('permits exactly 500 verses and rejects the 501st atomically', () => {
    const full = addItems([], fiveHundred());
    expect(full.length).toBeGreaterThan(1);
    expect(() => addItems(full, [esv('John 3:16')])).toThrow('500 ESV verses');
    expect(full.length).toBeGreaterThan(1);
    expect(full.every((i) => i.text === exact)).toBe(true);
  });
  it('rejects over-cap persistence including undo/import bypasses before touching IndexedDB', async () => {
    const state = emptyState();
    state.items = [...fiveHundred(), esv()];
    await expect(persist(state)).rejects.toThrow('500 ESV verses');
  });
  it('counts overlapping passages once and excludes tombstones/non-ESV', () => {
    const full = fiveHundred();
    expect(() =>
      assertEsvLimit([
        ...full,
        esv('Psalm 1:1'),
        { ...esv(), deleted: true },
        { ...esv(), id: 'kjv-jhn-3-16', translation: 'KJV' },
      ]),
    ).not.toThrow();
  });
  it('rejects missing, forged, excessive, and mismatched verse metadata', () => {
    for (const esvVerseKeys of [
      undefined,
      [],
      ['made-up'],
      ['jhn-3-17'],
      Array(501).fill('jhn-3-16'),
    ])
      expect(() => assertEsvLimit([{ ...esv(), esvVerseKeys }])).toThrow();
  });
  it('honors the publisher half-book cache limit in addition to the 500-verse cap', () => {
    expect(() => assertEsvLimit([esv('Jude 1:1-12')])).not.toThrow();
    expect(() => assertEsvLimit([esv('Jude 1:1-13')])).toThrow('half of any Bible book');
  });
  it('validates canonical ranges including cross-chapter and whole chapters', () => {
    expect(esvReferenceKeys('John 3:36–4:2')).toEqual(['jhn-3-36', 'jhn-4-1', 'jhn-4-2']);
    expect(esvReferenceKeys('Psalm 23')).toHaveLength(6);
    for (const ref of ['fake 1', 'John 3:37', 'John 4:2–3:1', 'John 3:0', 'Genesis 1-50'])
      expect(() => esvReferenceKeys(ref)).toThrow();
  });
});
