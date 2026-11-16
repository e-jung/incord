import books from '../public/content/books.json' with { type: 'json' };
import chapterCounts from './esv-structure.json' with { type: 'json' };
/** Reference-only ESV metadata shared by the device and Worker; never import browser storage here. */
export const ESV_VERSE_LIMIT = 500;
export const ESV_LIMIT_MESSAGE =
  'Your library can hold up to 500 ESV verses. Remove an ESV passage before adding more.';
export const ESV_OFFLINE_MESSAGE = 'Connect once to load this ESV passage.';
export type EsvRecord = {
  id: string;
  translation?: string;
  text?: string;
  deleted?: boolean;
  reference?: string;
  esvVerseKeys?: string[];
};
export const isEsv = (item: Pick<EsvRecord, 'id' | 'translation'>) =>
  item.translation?.toUpperCase() === 'ESV' || /^esv-/i.test(item.id);
/** Empty text remains schema-compatible with existing sync records. No quotation crosses the network. */
export function stripEsvText<T extends EsvRecord>(item: T): T {
  if (!isEsv(item)) return item;
  const clean = { ...item, text: '' } as T & { heading?: string };
  delete clean.heading;
  return clean;
}
export function esvVerseKeys(item: EsvRecord): string[] {
  if (!isEsv(item) || item.deleted) return [];
  const keys = item.esvVerseKeys;
  if (
    !Array.isArray(keys) ||
    !keys.length ||
    keys.length > ESV_VERSE_LIMIT ||
    keys.some(
      (key) => typeof key !== 'string' || !/^[1-3]?[a-z]{2,3}-[1-9]\d{0,2}-[1-9]\d{0,2}$/.test(key),
    )
  )
    throw Error('This ESV passage needs valid verse references. Find it again in Discover.');
  const resolved = item.reference ? esvReferenceKeys(item.reference) : [];
  if (JSON.stringify([...new Set(keys)].sort()) !== JSON.stringify(resolved.sort()))
    throw Error('This ESV passage needs valid verse references. Find it again in Discover.');
  return keys;
}
export function assertEsvLimit(items: EsvRecord[]): void {
  // Fail the global limit before detailed coordinate validation (including conflicting device libraries).
  const claimed = new Set(
    items
      .filter((item) => isEsv(item) && !item.deleted)
      .flatMap((item) => (Array.isArray(item.esvVerseKeys) ? item.esvVerseKeys : [])),
  );
  if (claimed.size > ESV_VERSE_LIMIT) throw Error(ESV_LIMIT_MESSAGE);
  const verses = new Set(items.flatMap(esvVerseKeys));
  if (verses.size > ESV_VERSE_LIMIT) throw Error(ESV_LIMIT_MESSAGE);
  assertEsvBookLimit([...verses]);
}

/** Canonical coordinates (not quotations), including text-critical omissions: a conservative count. */
export function esvReferenceKeys(reference: string): string[] {
  const match = /^(.+?) (\d+)(?::(\d+))?(?:[-–](\d+)(?::(\d+))?)?$/.exec(reference);
  if (!match) throw Error('Enter a Bible passage reference.');
  const book = books.find(
    (b) =>
      b.name.toLowerCase() === match[1].toLowerCase() ||
      (b.id === 'psa' && match[1].toLowerCase() === 'psalm'),
  );
  if (!book) throw Error('Enter a Bible passage reference.');
  const counts = chapterCounts[book.id as keyof typeof chapterCounts];
  const start = Number(match[2]),
    first = Number(match[3] || 1),
    end = Number(match[5] ? match[4] : match[3] ? match[2] : match[4] || match[2]);
  const last = Number(match[5] || (match[3] ? match[4] || match[3] : counts[end - 1]));
  if (
    !counts[start - 1] ||
    !counts[end - 1] ||
    end < start ||
    first < 1 ||
    first > counts[start - 1] ||
    last < 1 ||
    last > counts[end - 1] ||
    (start === end && last < first)
  )
    throw Error('Enter a valid Bible passage range.');
  const keys: string[] = [];
  for (let c = start; c <= end; c++)
    for (let v = c === start ? first : 1; v <= (c === end ? last : counts[c - 1]); v++) {
      keys.push(`${book.id}-${c}-${v}`);
      if (keys.length > ESV_VERSE_LIMIT) throw Error(ESV_LIMIT_MESSAGE);
    }
  return keys;
}

/** Crossway's usage terms also limit local quotations to half of any book. */
export function assertEsvBookLimit(keys: string[], query = false): void {
  const counts = new Map<string, number>();
  for (const key of new Set(keys)) {
    const book = key.split('-')[0];
    counts.set(book, (counts.get(book) || 0) + 1);
  }
  for (const [id, count] of counts) {
    const chapters = chapterCounts[id as keyof typeof chapterCounts];
    if (!chapters) throw Error('Enter a Bible passage reference.');
    if (query && chapters.length <= 2) continue; // Publisher exception for single-/double-chapter queries only.
    if (count > Math.floor(chapters.reduce((sum, n) => sum + n, 0) / 2))
      throw Error(
        'ESV permission allows saving no more than half of any Bible book. Remove a passage from this book before adding more.',
      );
  }
}
