import {readFile} from 'node:fs/promises';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {passages, passageTranslations, loadPassage, loadPassages, type PassageTranslation} from './passages';

// Actual checked-in packs, not fixture verse text; no network/API requests.
const ranges = [
  ['psa', 1, 1, 6], ['psa', 23, 1, 6], ['psa', 100, 1, 5], ['psa', 121, 1, 8],
  ['isa', 53, 4, 6], ['mat', 5, 3, 12], ['mat', 6, 9, 13], ['jhn', 1, 1, 5],
  ['jhn', 15, 5, 8], ['rom', 8, 31, 39], ['rom', 12, 1, 2], ['1co', 13, 4, 8],
  ['eph', 2, 8, 10], ['php', 2, 5, 11], ['php', 4, 4, 8], ['col', 3, 12, 17], ['heb', 12, 1, 2],
] as const;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toMatch(/^\/content\/(bsb|kjv|web)\/[a-z0-9]+\.json$/);
    return new Response(await readFile(new URL('../public' + url, import.meta.url), 'utf8'));
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('curated single-item passages', () => {
  it('publishes the 17 suggested selections with stable unique catalog ids and titles', () => {
    expect(passages).toHaveLength(17);
    expect(new Set(passages.map(p => p.id)).size).toBe(17);
    expect(passages.every(p => p.title.trim() && p.reference.trim())).toBe(true);
    expect(passageTranslations).toEqual(['BSB', 'KJV', 'WEB', 'ESV']);
    expect(passages[11].reference).toBe('1 Corinthians 13:4–8'); // Includes the full verse 8.
  });

  for (const translation of ['BSB', 'KJV', 'WEB'] as const) {
    it(`loads all 17 complete selections as one item each from real ${translation} packs`, async () => {
      const items = await loadPassages(translation);
      expect(items).toHaveLength(17);
      for (const [index, [book, chapter, start, end]] of ranges.entries()) {
        const pack = JSON.parse(await readFile(new URL(`../public/content/${translation.toLowerCase()}/${book}.json`, import.meta.url), 'utf8'));
        const texts = Array.from({length: end - start + 1}, (_, offset) => pack.chapters[chapter][start + offset]);
        expect(texts.every(text => typeof text === 'string' && text.trim())).toBe(true);
        expect(passages[index].verseCount).toBe(texts.length);
        expect(items[index]).toMatchObject({
          id: `${translation.toLowerCase()}-${book}-${chapter}-${start}--${translation.toLowerCase()}-${book}-${chapter}-${end}`,
          collection: 'bible', translation, reference: passages[index].reference,
          text: texts.join(' '),
        });
        expect(items[index].title).toMatch(new RegExp(` ${chapter}:${start}–${end}$`));
        // Superscriptions are metadata, never prepended to practice text.
        if (start === 1 && pack.headings?.[chapter]) expect(items[index].heading).toBe(pack.headings[chapter]);
      }
      expect(new Set(items.map(item => item.id)).size).toBe(17);
    });
  }

  it('loads all ESV selections as reference-only metadata without requesting publisher text', async () => {
    const items = await loadPassages('ESV');
    expect(items).toHaveLength(17);
    for (const [index, item] of items.entries()) {
      expect(item.translation).toBe('ESV');
      expect(item.text).toBe('');
      expect(item.esvVerseKeys).toHaveLength(passages[index].verseCount);
      expect(item.id).toMatch(/^esv-/);
    }
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith('/content/bsb/'))).toBe(true);
  });

  it('defaults to BSB and rejects unknown ids and unsupported translations', async () => {
    expect((await loadPassage('psalm-23')).translation).toBe('BSB');
    await expect(loadPassage('missing')).rejects.toThrow('Unknown passage');
    for (const translation of ['NIV']) {
      await expect(loadPassage('psalm-23', translation as PassageTranslation)).rejects.toThrow('Choose BSB, KJV, WEB, or ESV');
    }
  });
});
