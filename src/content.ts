import {assertEsvLimit, esvReferenceKeys, ESV_OFFLINE_MESSAGE} from '../shared/esv';
import {contentCopy} from './config/copy';
/** Public-domain content. Bible books load only on demand; documents/starters are available offline in the shell. */
import documentData from '../public/content/documents.json';
import starterData from '../public/content/starters.json';
import bookData from '../public/content/books.json';

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
  items: ContentItem[];
}
export const starters: ContentCollection[] = starterData;
export const documents: ContentCollection[] = documentData;
export const books = bookData;
export const translations: Translation[] = ['BSB', 'KJV', 'WEB', 'ESV'];
interface BookPack { book: string; translation: Translation; chapters: Record<string, Record<string, string>>; headings?: Record<string, string> }
const cache = new Map<string, Promise<BookPack>>();
const normalize = (s: string) => s.toLowerCase().replace(/\./g, '').replace(/\s/g, '');
const aliases = new Map<string, string>();
for (const book of books) {
  aliases.set(normalize(book.name), book.id);
  aliases.set(book.id, book.id);
}
const conventionalAliases: Record<string, string[]> = {
  gen: ['Ge', 'Gn'], exo: ['Ex', 'Exod'], lev: ['Le', 'Lv'], num: ['Nu', 'Nm'], deu: ['De', 'Dt', 'Deut'],
  jos: ['Josh'], jdg: ['Judg', 'Jdg'], rut: ['Ru'], '1sa': ['1 Sam', '1 Sa'], '2sa': ['2 Sam', '2 Sa'],
  '1ki': ['1 Kgs'], '2ki': ['2 Kgs'], '1ch': ['1 Chr', '1 Chron'], '2ch': ['2 Chr', '2 Chron'],
  ezr: ['Ezra'], neh: ['Ne'], est: ['Esth'], psa: ['Psalm', 'Ps', 'Pss'], pro: ['Pr', 'Prov'], ecc: ['Ec', 'Eccl'],
  sng: ['Song', 'Song of Songs', 'Song of Solomon', 'Canticles', 'SoS'], isa: ['Is'], jer: ['Je'], lam: ['La'],
  ezk: ['Ezek', 'Eze'], dan: ['Da', 'Dn'], hos: ['Ho'], jol: ['Jl'], amo: ['Am'], oba: ['Ob', 'Obad'],
  jon: ['Jnh'], mic: ['Mi'], nam: ['Nah', 'Na'], hab: ['Hb'], zep: ['Zeph'], hag: ['Hg'], zec: ['Zech'], mal: ['Ml'],
  mat: ['Mt', 'Matt'], mrk: ['Mk', 'Mar'], luk: ['Lk', 'Lu'], jhn: ['Jn', 'Joh'], act: ['Ac'], rom: ['Ro', 'Rm'],
  '1co': ['1 Cor'], '2co': ['2 Cor'], gal: ['Ga'], eph: ['Ep'], php: ['Phil', 'Php', 'Pp'], col: ['Co'],
  '1th': ['1 Thess', '1 Thes'], '2th': ['2 Thess', '2 Thes'], '1ti': ['1 Tim'], '2ti': ['2 Tim'], tit: ['Ti'],
  phm: ['Philem', 'Phlm'], heb: ['He'], jas: ['Jam', 'Jm'], '1pe': ['1 Pet', '1 Pt'], '2pe': ['2 Pet', '2 Pt'],
  '1jn': ['1 Jn'], '2jn': ['2 Jn'], '3jn': ['3 Jn'], jud: ['Jude'], rev: ['Re', 'Rv', 'Apocalypse'],
};
for (const [id, names] of Object.entries(conventionalAliases)) for (const name of names) aliases.set(normalize(name), id);
async function loadBook(id: string, translation: Translation): Promise<BookPack> {
  const key = `${translation.toLowerCase()}/${id}`;
  let promise = cache.get(key);
  if (!promise) {
    promise = fetch(`${import.meta.env.BASE_URL}content/${key}.json`).then(async response => {
      if (!response.ok) throw Error(contentCopy.offline);
      return response.json() as Promise<BookPack>;
    }).catch(() => { cache.delete(key); throw Error(contentCopy.offline); });
    cache.set(key, promise);
  }
  return promise;
}

/** Accept a verse, range, chapter, chapter range, or cross-chapter range. Never silently truncate invalid requests. */
export async function lookupReference(reference: string, translation: string = 'BSB'): Promise<ContentItem[]> {
  const tr = translation.toUpperCase();
  if (!translations.includes(tr as Translation)) throw Error(contentCopy.translation);
  if (tr === 'ESV') return lookupEsvReference(reference);
  const input = reference.trim().replace(/[–—]/g, '-').replace(/^(III|II|I)\s+/i, (_, roman: string) => `${roman.length} `);
  const match = /^(.+?)\s*(\d+)(?:[:.\s](\d+))?(?:\s*-\s*(\d+)(?:[:.\s](\d+))?)?$/.exec(input);
  if (!match) throw Error(contentCopy.reference);
  let [, bookName, first, verse, end, endVerse] = match;
  const id = aliases.get(normalize(bookName));
  if (!id) throw Error(contentCopy.book);
  if (['oba', 'phm', '2jn', '3jn', 'jud'].includes(id) && !verse) {
    verse = first;
    first = '1';
  }
  const pack = await loadBook(id, tr as Translation);
  const firstChapter = Number(first);
  const lastChapter = endVerse ? Number(end) : (verse ? firstChapter : Number(end ?? first));
  const firstVerse = verse ? Number(verse) : 1;
  const lastVerse = endVerse ? Number(endVerse) : (verse ? Number(end ?? verse) : Infinity);
  if (firstChapter < 1 || firstVerse < 1 || lastChapter < firstChapter || lastVerse < 1 || (firstChapter === lastChapter && lastVerse < firstVerse)) throw Error(contentCopy.range);
  if (!pack.chapters[firstChapter] || !pack.chapters[lastChapter]) throw Error(contentCopy.chapter);
  if (verse && (!pack.chapters[firstChapter][firstVerse] || !pack.chapters[lastChapter][lastVerse])) throw Error(contentCopy.verse(tr));
  const result: ContentItem[] = [];
  for (let c = firstChapter; c <= lastChapter; c++) {
    const chapter = pack.chapters[c];
    if (!chapter) throw Error(contentCopy.chapter);
    for (const [v, text] of Object.entries(chapter)) {
      const n = Number(v);
      if ((c === firstChapter && n < firstVerse) || (c === lastChapter && n > lastVerse)) continue;
      if (!text) continue; // The source retains a few text-critical omissions as empty verse slots.
      result.push({ id: `${tr.toLowerCase()}-${id}-${c}-${v}`, title: `${id === 'psa' ? 'Psalm' : pack.book} ${c}:${v}`, text, collection: 'bible', translation: tr, ...(n === 1 && pack.headings?.[c] ? { heading: pack.headings[c] } : {}) });
    }
  }
  if (!result.length) throw Error(contentCopy.empty);
  return result;
}

/** Publisher text is fetched as one exact passage, never split/rejoined using guessed verse boundaries. */
export async function lookupEsvReference(reference: string): Promise<ContentItem[]> {
  const coordinates = await lookupReference(reference, 'BSB');
  const first = coordinates[0], last = coordinates[coordinates.length - 1];
  const canonicalReference = first.title === last.title ? first.title : first.title + '–' + (first.title.split(':')[0] === last.title.split(':')[0] ? last.title.split(':')[1] : last.title.split(' ').at(-1));
  const item: ContentItem = {id: 'esv-' + first.id.slice(4) + (coordinates.length > 1 ? '--esv-' + last.id.slice(4) : ''), title: canonicalReference, reference: canonicalReference, text: '', collection: 'bible', translation: 'ESV', esvVerseKeys: esvReferenceKeys(canonicalReference)};
  assertEsvLimit([item]);
  item.text = await fetchEsvText(canonicalReference);
  return [item];
}
export async function fetchEsvText(reference: string): Promise<string> {
  try {
    const response = await fetch('/api/esv?q=' + encodeURIComponent(reference), {cache:'no-store'});
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw Error(result?.error || ESV_OFFLINE_MESSAGE);
    }
    const text = await response.text();
    if (!text.trim()) throw Error(ESV_OFFLINE_MESSAGE);
    return text;
  } catch (error) {
    if (error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)) throw Error(ESV_OFFLINE_MESSAGE);
    throw error;
  }
}
/** Full wording checked against api.esv.org on 2026-11-13 (docs link to these usage terms). */
export const esvAttribution = {
  label: 'ESV', short: '(ESV)', url: 'https://www.esv.org',
  copyright: 'Scripture quotations marked “ESV” are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved. The ESV text may not be quoted in any publication made available to the public by a Creative Commons license. The ESV may not be translated into any other language. Users may not copy or download more than 500 verses of the ESV Bible or more than one half of any book of the ESV Bible.',
};
