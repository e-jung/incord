/** IO-free catalog: bundled definitions plus resolvers supplied with a book loader. */
import { assertEsvLimit, esvReferenceKeys } from '../esv';
import { topics } from '../topics';
import documentData from '../../public/content/documents.json' with { type: 'json' };
import starterData from '../../public/content/starters.json' with { type: 'json' };
import bookData from '../../public/content/books.json' with { type: 'json' };
export { topics };
export type Translation = 'BSB' | 'KJV' | 'WEB' | 'ESV';
export interface ContentItem {
  id: string;
  title: string;
  text: string;
  collection: string;
  translation: string;
  number?: number;
  lordsDay?: number;
  part?: number;
  parts?: number;
  heading?: string;
  reference?: string;
  esvVerseKeys?: string[];
}
export interface ContentCollection {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  questionCount?: number;
  description?: string;
  items: ContentItem[];
}
export const starters: ContentCollection[] = starterData;
export const documents: ContentCollection[] = documentData;
export const books = bookData;
export const translations: Translation[] = ['BSB', 'KJV', 'WEB', 'ESV'];
export interface BookPack {
  book: string;
  translation?: Translation;
  chapters: Record<string, Record<string, string>>;
  headings?: Record<string, string>;
}
export type BookLoader = (id: string, translation: Translation) => Promise<BookPack>;
export const referenceMessages = {
  translation: 'Choose BSB, KJV, WEB, or ESV.',
  reference: 'Enter a Bible passage reference.',
  book: 'Unknown Bible book.',
  range: 'Enter a valid Bible passage range.',
  chapter: 'Enter a valid chapter.',
  verse: (_translation: string) => 'Enter a valid verse.',
  empty: 'No verses found.',
};
export interface LookupOptions {
  maxVerses?: number;
  messages?: typeof referenceMessages;
}
const normalize = (s: string) => s.toLowerCase().replace(/\./g, '').replace(/\s/g, '');
const aliases = new Map<string, string>();
for (const book of books) {
  aliases.set(normalize(book.name), book.id);
  aliases.set(book.id, book.id);
}
const conventionalAliases: Record<string, string[]> = {
  gen: ['Ge', 'Gn'],
  exo: ['Ex', 'Exod'],
  lev: ['Le', 'Lv'],
  num: ['Nu', 'Nm'],
  deu: ['De', 'Dt', 'Deut'],
  jos: ['Josh'],
  jdg: ['Judg', 'Jdg'],
  rut: ['Ru'],
  '1sa': ['1 Sam', '1 Sa'],
  '2sa': ['2 Sam', '2 Sa'],
  '1ki': ['1 Kgs'],
  '2ki': ['2 Kgs'],
  '1ch': ['1 Chr', '1 Chron'],
  '2ch': ['2 Chr', '2 Chron'],
  ezr: ['Ezra'],
  neh: ['Ne'],
  est: ['Esth'],
  psa: ['Psalm', 'Ps', 'Pss'],
  pro: ['Pr', 'Prov'],
  ecc: ['Ec', 'Eccl'],
  sng: ['Song', 'Song of Songs', 'Song of Solomon', 'Canticles', 'SoS'],
  isa: ['Is'],
  jer: ['Je'],
  lam: ['La'],
  ezk: ['Ezek', 'Eze'],
  dan: ['Da', 'Dn'],
  hos: ['Ho'],
  jol: ['Jl'],
  amo: ['Am'],
  oba: ['Ob', 'Obad'],
  jon: ['Jnh'],
  mic: ['Mi'],
  nam: ['Nah', 'Na'],
  hab: ['Hb'],
  zep: ['Zeph'],
  hag: ['Hg'],
  zec: ['Zech'],
  mal: ['Ml'],
  mat: ['Mt', 'Matt'],
  mrk: ['Mk', 'Mar'],
  luk: ['Lk', 'Lu'],
  jhn: ['Jn', 'Joh'],
  act: ['Ac'],
  rom: ['Ro', 'Rm'],
  '1co': ['1 Cor'],
  '2co': ['2 Cor'],
  gal: ['Ga'],
  eph: ['Ep'],
  php: ['Phil', 'Php', 'Pp'],
  col: ['Co'],
  '1th': ['1 Thess', '1 Thes'],
  '2th': ['2 Thess', '2 Thes'],
  '1ti': ['1 Tim'],
  '2ti': ['2 Tim'],
  tit: ['Ti'],
  phm: ['Philem', 'Phlm'],
  heb: ['He'],
  jas: ['Jam', 'Jm'],
  '1pe': ['1 Pet', '1 Pt'],
  '2pe': ['2 Pet', '2 Pt'],
  '1jn': ['1 Jn'],
  '2jn': ['2 Jn'],
  '3jn': ['3 Jn'],
  jud: ['Jude'],
  rev: ['Re', 'Rv', 'Apocalypse'],
};
for (const [id, names] of Object.entries(conventionalAliases))
  for (const name of names) aliases.set(normalize(name), id);
export const passageTranslations = translations;
export type PassageTranslation = (typeof passageTranslations)[number];
export interface PassageMetadata {
  /** Translation-independent catalog key, not the saved Scripture item's id. */
  id: string;
  title: string;
  reference: string;
  verseCount: number;
}

/** Longer selections are deliberately a single memory item, never chunks or starters. */
export const passages: readonly PassageMetadata[] = [
  { id: 'psalm-1', title: 'The way of the righteous', reference: 'Psalm 1', verseCount: 6 },
  { id: 'psalm-23', title: 'The Lord is my shepherd', reference: 'Psalm 23', verseCount: 6 },
  { id: 'psalm-100', title: 'A psalm of thanksgiving', reference: 'Psalm 100', verseCount: 5 },
  { id: 'psalm-121', title: 'My help comes from the Lord', reference: 'Psalm 121', verseCount: 8 },
  { id: 'isaiah-53-4-6', title: 'By His wounds', reference: 'Isaiah 53:4–6', verseCount: 3 },
  { id: 'matthew-5-3-12', title: 'The Beatitudes', reference: 'Matthew 5:3–12', verseCount: 10 },
  { id: 'matthew-6-9-13', title: 'The Lord’s Prayer', reference: 'Matthew 6:9–13', verseCount: 5 },
  {
    id: 'john-1-1-5',
    title: 'In the beginning was the Word',
    reference: 'John 1:1–5',
    verseCount: 5,
  },
  {
    id: 'john-15-5-8',
    title: 'The vine and the branches',
    reference: 'John 15:5–8',
    verseCount: 4,
  },
  {
    id: 'romans-8-31-39',
    title: 'More than conquerors',
    reference: 'Romans 8:31–39',
    verseCount: 9,
  },
  { id: 'romans-12-1-2', title: 'A living sacrifice', reference: 'Romans 12:1–2', verseCount: 2 },
  {
    id: '1-corinthians-13-4-8',
    title: 'Love never fails',
    reference: '1 Corinthians 13:4–8',
    verseCount: 5,
  },
  { id: 'ephesians-2-8-10', title: 'Saved by grace', reference: 'Ephesians 2:8–10', verseCount: 3 },
  {
    id: 'philippians-2-5-11',
    title: 'The humility of Christ',
    reference: 'Philippians 2:5–11',
    verseCount: 7,
  },
  {
    id: 'philippians-4-4-8',
    title: 'Rejoice in the Lord',
    reference: 'Philippians 4:4–8',
    verseCount: 5,
  },
  {
    id: 'colossians-3-12-17',
    title: 'Clothe yourselves with love',
    reference: 'Colossians 3:12–17',
    verseCount: 6,
  },
  { id: 'hebrews-12-1-2', title: 'Run with endurance', reference: 'Hebrews 12:1–2', verseCount: 2 },
];

/** Accept a verse, range, chapter, chapter range, or cross-chapter range. Never silently truncate invalid requests. */
export async function lookupReference(
  reference: string,
  translation: string,
  loader: BookLoader,
  options: LookupOptions = {},
): Promise<ContentItem[]> {
  const contentCopy = options.messages ?? referenceMessages;
  const tr = translation.toUpperCase();
  if (!translations.includes(tr as Translation)) throw Error(contentCopy.translation);
  if (tr === 'ESV') return lookupEsvReference(reference, loader, options);
  const input = reference
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/^(III|II|I)\s+/i, (_, roman: string) => `${roman.length} `);
  const match = /^(.+?)\s*(\d+)(?:[:.\s](\d+))?(?:\s*-\s*(\d+)(?:[:.\s](\d+))?)?$/.exec(input);
  if (!match) throw Error(contentCopy.reference);
  let [, bookName, first, verse, end, endVerse] = match;
  const id = aliases.get(normalize(bookName));
  if (!id) throw Error(contentCopy.book);
  if (['oba', 'phm', '2jn', '3jn', 'jud'].includes(id) && !verse) {
    verse = first;
    first = '1';
  }
  const pack = await loader(id, tr as Translation);
  const firstChapter = Number(first);
  const lastChapter = endVerse ? Number(end) : verse ? firstChapter : Number(end ?? first);
  const firstVerse = verse ? Number(verse) : 1;
  const lastVerse = endVerse ? Number(endVerse) : verse ? Number(end ?? verse) : Infinity;
  if (
    firstChapter < 1 ||
    firstVerse < 1 ||
    lastChapter < firstChapter ||
    lastVerse < 1 ||
    (firstChapter === lastChapter && lastVerse < firstVerse)
  )
    throw Error(contentCopy.range);
  if (!pack.chapters[firstChapter] || !pack.chapters[lastChapter]) throw Error(contentCopy.chapter);
  if (verse && (!pack.chapters[firstChapter][firstVerse] || !pack.chapters[lastChapter][lastVerse]))
    throw Error(contentCopy.verse(tr));
  const result: ContentItem[] = [];
  for (let c = firstChapter; c <= lastChapter; c++) {
    const chapter = pack.chapters[c];
    if (!chapter) throw Error(contentCopy.chapter);
    for (const [v, text] of Object.entries(chapter)) {
      const n = Number(v);
      if ((c === firstChapter && n < firstVerse) || (c === lastChapter && n > lastVerse)) continue;
      if (!text) continue; // The source retains a few text-critical omissions as empty verse slots.
      if (result.length >= (options.maxVerses ?? Infinity))
        throw Error(`Each reference is limited to ${options.maxVerses} verses.`);
      result.push({
        id: `${tr.toLowerCase()}-${id}-${c}-${v}`,
        title: `${id === 'psa' ? 'Psalm' : pack.book} ${c}:${v}`,
        text,
        collection: 'bible',
        translation: tr,
        ...(n === 1 && pack.headings?.[c] ? { heading: pack.headings[c] } : {}),
      });
    }
  }
  if (!result.length) throw Error(contentCopy.empty);
  return result;
}

/** Resolve ESV metadata without publisher text; preview/practice loads one exact passage on this device. */
export async function lookupEsvReference(
  reference: string,
  loader: BookLoader,
  options: LookupOptions = {},
): Promise<ContentItem[]> {
  const coordinates = await lookupReference(reference, 'BSB', loader, options);
  const first = coordinates[0],
    last = coordinates[coordinates.length - 1];
  const canonicalReference = rangeTitle(first, last);
  const item: ContentItem = {
    id: 'esv-' + first.id.slice(4) + (coordinates.length > 1 ? '--esv-' + last.id.slice(4) : ''),
    title: canonicalReference,
    reference: canonicalReference,
    text: '',
    collection: 'bible',
    translation: 'ESV',
    esvVerseKeys: esvReferenceKeys(canonicalReference),
  };
  assertEsvLimit([item]);
  return [item];
}
export async function loadPassage(
  id: string,
  translation: PassageTranslation,
  loader: BookLoader,
  options: LookupOptions = {},
): Promise<ContentItem> {
  const passage = passages.find((p) => p.id === id);
  if (!passage) throw Error('Unknown passage.');
  if (!passageTranslations.includes(translation)) throw Error('Choose BSB, KJV, WEB, or ESV.');
  if (translation === 'ESV')
    return (await lookupEsvReference(passage.reference, loader, options))[0];
  const verses = await lookupReference(passage.reference, translation, loader, options);
  if (verses.length !== passage.verseCount || verses.some((v) => !v.text.trim()))
    throw Error('The complete passage is unavailable.');
  const first = verses[0],
    last = verses[verses.length - 1];
  return {
    ...first,
    id: first.id + '--' + last.id,
    title: first.title + '–' + last.title.split(':').at(-1),
    reference: passage.reference,
    text: verses.map((v) => v.text).join(' '),
  };
}

/** Load the complete catalog in its curated order, with one item per passage. */
export async function loadPassages(
  translation: PassageTranslation,
  loader: BookLoader,
  options: LookupOptions = {},
): Promise<ContentItem[]> {
  return Promise.all(passages.map((p) => loadPassage(p.id, translation, loader, options)));
}

/** Resolve a catalog item without a transport, storage, or synthetic MCP request. */
export async function resolveCatalogItem(
  id: string,
  translation: Translation,
  loader: BookLoader,
  options: LookupOptions = {},
): Promise<ContentItem[]> {
  if (passages.some((p) => p.id === id))
    return [await loadPassage(id, translation, loader, options)];
  if (topics.some((t) => `topic-${t.id}` === id))
    return loadTopic(id.slice(6), translation, loader, options);
  const found = [...starters, ...documents].flatMap((c) => c.items).find((i) => i.id === id);
  if (!found) throw Error('Unknown catalog item ID.');
  return [{ ...found }];
}
export function rangeTitle(first: ContentItem, last: ContentItem): string {
  return first.title === last.title
    ? first.title
    : first.title +
        '–' +
        (first.title.split(':')[0] === last.title.split(':')[0]
          ? last.title.split(':').at(-1)
          : last.title.split(' ').at(-1));
}
export function joinVerses(verses: ContentItem[]): ContentItem {
  const first = verses[0],
    last = verses[verses.length - 1];
  return {
    ...first,
    id: first.id + (verses.length > 1 ? '--' + last.id : ''),
    title: rangeTitle(first, last),
    reference: rangeTitle(first, last),
    text: first.translation === 'ESV' ? '' : verses.map((v) => v.text).join(' '),
    ...(first.translation === 'ESV'
      ? { esvVerseKeys: verses.flatMap((v) => v.esvVerseKeys || []) }
      : {}),
  };
}

/** One canonical item per topic verse, with ESV restricted to reference metadata. */
export async function loadTopic(
  id: string,
  translation: Translation,
  loader: BookLoader,
  options: LookupOptions = {},
): Promise<ContentItem[]> {
  const topic = topics.find((t) => t.id === id);
  if (!topic) throw Error('Unknown topic.');
  if (!translations.includes(translation)) throw Error('Choose BSB, KJV, WEB, or ESV.');
  const verses = (
    await Promise.all(
      topic.references.map((reference) =>
        lookupReference(reference, translation === 'ESV' ? 'BSB' : translation, loader, options),
      ),
    )
  ).flat();
  if (verses.length !== topic.verseCount || verses.some((v) => !v.text.trim()))
    throw Error('The complete topic is unavailable.');
  const items =
    translation === 'ESV'
      ? (await Promise.all(verses.map((v) => lookupEsvReference(v.title, loader, options)))).flat()
      : verses;
  return items.map((item) => ({ ...item, collection: `topic-${topic.id}` }));
}
