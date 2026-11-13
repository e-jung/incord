/** Public-domain content. Bible books load only on demand; documents/starters are available offline in the shell. */
import documentData from '../public/content/documents.json';
import starterData from '../public/content/starters.json';
import bookData from '../public/content/books.json';

export type Translation = 'BSB' | 'KJV' | 'WEB';
export interface ContentItem {
  id: string;
  title: string;
  text: string;
  collection: string;
  translation: string;
  number?: number;
  lordsDay?: number;
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
export const translations: Translation[] = ['BSB', 'KJV', 'WEB'];
interface BookPack { book: string; translation: Translation; chapters: Record<string, Record<string, string>> }
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
      if (!response.ok) throw Error('This Bible book is not available offline yet. Connect once to download it.');
      return response.json() as Promise<BookPack>;
    }).catch(error => { cache.delete(key); throw error; });
    cache.set(key, promise);
  }
  return promise;
}

/** Accept a verse, range, chapter, chapter range, or cross-chapter range. Never silently truncate invalid requests. */
export async function lookupReference(reference: string, translation: string = 'BSB'): Promise<ContentItem[]> {
  const tr = translation.toUpperCase();
  if (!translations.includes(tr as Translation)) throw Error('Choose BSB, KJV, or WEB.');
  const input = reference.trim().replace(/[–—]/g, '-').replace(/^(III|II|I)\s+/i, (_, roman: string) => `${roman.length} `);
  const match = /^(.+?)\s*(\d+)(?::(\d+))?(?:\s*-\s*(\d+)(?::(\d+))?)?$/.exec(input);
  if (!match) throw Error('Enter a reference such as Romans 8:28-30 or Psalm 23.');
  const [, bookName, first, verse, end, endVerse] = match;
  const id = aliases.get(normalize(bookName));
  if (!id) throw Error('That Bible book was not recognized.');
  const pack = await loadBook(id, tr as Translation);
  const firstChapter = Number(first);
  const lastChapter = endVerse ? Number(end) : (verse ? firstChapter : Number(end ?? first));
  const firstVerse = verse ? Number(verse) : 1;
  const lastVerse = endVerse ? Number(endVerse) : (verse ? Number(end ?? verse) : Infinity);
  if (firstChapter < 1 || firstVerse < 1 || lastChapter < firstChapter || lastVerse < 1 || (firstChapter === lastChapter && lastVerse < firstVerse)) throw Error('The end of the passage must follow its beginning.');
  if (!pack.chapters[firstChapter] || !pack.chapters[lastChapter]) throw Error('That chapter does not exist in this book.');
  if (verse && (!pack.chapters[firstChapter][firstVerse] || !pack.chapters[lastChapter][lastVerse])) throw Error(`That verse is not present in ${tr}. Check the reference or translation.`);
  const result: ContentItem[] = [];
  for (let c = firstChapter; c <= lastChapter; c++) {
    const chapter = pack.chapters[c];
    if (!chapter) throw Error('That chapter does not exist in this book.');
    for (const [v, text] of Object.entries(chapter)) {
      const n = Number(v);
      if ((c === firstChapter && n < firstVerse) || (c === lastChapter && n > lastVerse)) continue;
      if (!text) continue; // The source retains a few text-critical omissions as empty verse slots.
      result.push({ id: `${tr.toLowerCase()}-${id}-${c}-${v}`, title: `${pack.book} ${c}:${v}`, text, collection: 'bible', translation: tr });
    }
  }
  if (!result.length) throw Error('No verses found for that reference.');
  return result;
}
