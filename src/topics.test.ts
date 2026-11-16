import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTopic, topics } from './topics';
import type { Translation } from './content';

// Independent coordinates verify curated ranges against real checked-in packs.
const verses = (book: string, chapter: number, ...numbers: number[]) =>
  numbers.map((verse) => ({ book, chapter, verse }));
const expected = [
  [
    ...verses('jhn', 10, 27, 28, 29),
    ...verses('rom', 8, 1),
    ...verses('eph', 2, 8, 9),
    ...verses('1jn', 5, 13),
  ],
  [
    ...verses('php', 4, 6, 7),
    ...verses('isa', 26, 3),
    ...verses('1pe', 5, 7),
    ...verses('jhn', 14, 27),
    ...verses('mat', 6, 33, 34),
  ],
  [...verses('mat', 6, 9, 10, 11, 12, 13), ...verses('1jn', 5, 14), ...verses('heb', 4, 16)],
  [
    ...verses('1co', 10, 13),
    ...verses('jas', 1, 12, 13, 14, 15),
    ...verses('psa', 119, 11),
    ...verses('gal', 5, 16),
  ],
  [...verses('rom', 5, 3, 4, 5), ...verses('rom', 8, 18), ...verses('2co', 4, 16, 17, 18)],
  [
    ...verses('2co', 5, 17),
    ...verses('gal', 2, 20),
    ...verses('eph', 1, 4, 5),
    ...verses('1pe', 2, 9),
    ...verses('rom', 8, 14, 15),
  ],
  [
    ...verses('pro', 3, 5, 6),
    ...verses('jas', 1, 5),
    ...verses('psa', 119, 105),
    ...verses('pro', 16, 9),
    ...verses('psa', 32, 8),
    ...verses('jas', 3, 17),
  ],
  [
    ...verses('exo', 34, 6, 7),
    ...verses('psa', 103, 8, 9, 10),
    ...verses('1jn', 4, 8),
    ...verses('jas', 1, 17),
  ],
  [
    ...verses('mat', 28, 18, 19, 20),
    ...verses('act', 1, 8),
    ...verses('rom', 1, 16),
    ...verses('1pe', 3, 15),
    ...verses('2co', 5, 20),
  ],
  [
    ...verses('gen', 1, 1),
    ...verses('psa', 56, 3),
    ...verses('psa', 119, 105),
    ...verses('eph', 4, 32),
    ...verses('1th', 5, 16, 17, 18),
  ],
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(url).toMatch(/^\/content\/(bsb|kjv|web)\/[a-z0-9]+\.json$/);
      return new Response(await readFile(new URL('../public' + url, import.meta.url), 'utf8'));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('curated topic catalog', () => {
  it('publishes ten unique stable ids and complete metadata', () => {
    expect(topics.map((topic) => topic.title)).toEqual([
      'Assurance of salvation',
      'Anxiety & peace',
      'Prayer',
      'Temptation & holiness',
      'Suffering & hope',
      'Identity in Christ',
      'Wisdom & guidance',
      "God's character",
      'The Great Commission & witness',
      'Verses for kids',
    ]);
    expect(new Set(topics.map((topic) => topic.id)).size).toBe(10);
    for (const topic of topics) {
      expect(topic.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(topic.description.trim()).not.toBe('');
      expect(topic.references.length).toBeGreaterThan(0);
      expect(topic.verseCount).toBeGreaterThanOrEqual(6);
      expect(topic.verseCount).toBeLessThanOrEqual(8);
    }
  });

  for (const translation of ['BSB', 'KJV', 'WEB'] as const) {
    it(`resolves every reference to separate, complete ${translation} verses`, async () => {
      for (const [index, topic] of topics.entries()) {
        const items = await loadTopic(topic.id, translation);
        expect(items).toHaveLength(topic.verseCount);
        expect(items).toHaveLength(expected[index].length);
        expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
        for (const [verseIndex, { book, chapter, verse }] of expected[index].entries()) {
          const pack = JSON.parse(
            await readFile(
              new URL(
                `../public/content/${translation.toLowerCase()}/${book}.json`,
                import.meta.url,
              ),
              'utf8',
            ),
          );
          expect(items[verseIndex]).toMatchObject({
            id: `${translation.toLowerCase()}-${book}-${chapter}-${verse}`,
            collection: `topic-${topic.id}`,
            translation,
            text: pack.chapters[chapter][verse],
          });
          expect(items[verseIndex].text.trim()).not.toBe('');
        }
      }
    });
  }

  it('expands ESV ranges into individual reference-only verses without publisher requests', async () => {
    for (const [index, topic] of topics.entries()) {
      const items = await loadTopic(topic.id, 'ESV');
      expect(items).toHaveLength(topic.verseCount);
      for (const [verseIndex, { book, chapter, verse }] of expected[index].entries()) {
        expect(items[verseIndex]).toMatchObject({
          id: `esv-${book}-${chapter}-${verse}`,
          collection: `topic-${topic.id}`,
          translation: 'ESV',
          text: '',
          esvVerseKeys: [`${book}-${chapter}-${verse}`],
        });
        expect(items[verseIndex].reference).toBe(items[verseIndex].title);
        expect(items[verseIndex].reference).not.toMatch(/[–—]/);
      }
    }
    expect(
      vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith('/content/bsb/')),
    ).toBe(true);
  });

  it('defaults to BSB and rejects unknown ids and invalid translations', async () => {
    expect((await loadTopic('prayer'))[0].translation).toBe('BSB');
    await expect(loadTopic('missing')).rejects.toThrow('Unknown topic');
    for (const translation of ['NIV', '', 'bsb']) {
      await expect(loadTopic('prayer', translation as Translation)).rejects.toThrow(
        'Choose BSB, KJV, WEB, or ESV',
      );
    }
  });
});
