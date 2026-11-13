import {lookupReference, lookupEsvReference, type ContentItem} from './content';

/** ESV selections are reference-only until device preview or practice. */
export const passageTranslations = ['BSB', 'KJV', 'WEB', 'ESV'] as const;
export type PassageTranslation = typeof passageTranslations[number];
export interface PassageMetadata {
  /** Translation-independent catalog key, not the saved Scripture item's id. */
  id: string;
  title: string;
  reference: string;
  verseCount: number;
}

/** Longer selections are deliberately a single memory item, never chunks or starters. */
export const passages: readonly PassageMetadata[] = [
  {id: 'psalm-1', title: 'The way of the righteous', reference: 'Psalm 1', verseCount: 6},
  {id: 'psalm-23', title: 'The Lord is my shepherd', reference: 'Psalm 23', verseCount: 6},
  {id: 'psalm-100', title: 'A psalm of thanksgiving', reference: 'Psalm 100', verseCount: 5},
  {id: 'psalm-121', title: 'My help comes from the Lord', reference: 'Psalm 121', verseCount: 8},
  {id: 'isaiah-53-4-6', title: 'By His wounds', reference: 'Isaiah 53:4–6', verseCount: 3},
  {id: 'matthew-5-3-12', title: 'The Beatitudes', reference: 'Matthew 5:3–12', verseCount: 10},
  {id: 'matthew-6-9-13', title: 'The Lord’s Prayer', reference: 'Matthew 6:9–13', verseCount: 5},
  {id: 'john-1-1-5', title: 'In the beginning was the Word', reference: 'John 1:1–5', verseCount: 5},
  {id: 'john-15-5-8', title: 'The vine and the branches', reference: 'John 15:5–8', verseCount: 4},
  {id: 'romans-8-31-39', title: 'More than conquerors', reference: 'Romans 8:31–39', verseCount: 9},
  {id: 'romans-12-1-2', title: 'A living sacrifice', reference: 'Romans 12:1–2', verseCount: 2},
  {id: '1-corinthians-13-4-8', title: 'Love never fails', reference: '1 Corinthians 13:4–8', verseCount: 5},
  {id: 'ephesians-2-8-10', title: 'Saved by grace', reference: 'Ephesians 2:8–10', verseCount: 3},
  {id: 'philippians-2-5-11', title: 'The humility of Christ', reference: 'Philippians 2:5–11', verseCount: 7},
  {id: 'philippians-4-4-8', title: 'Rejoice in the Lord', reference: 'Philippians 4:4–8', verseCount: 5},
  {id: 'colossians-3-12-17', title: 'Clothe yourselves with love', reference: 'Colossians 3:12–17', verseCount: 6},
  {id: 'hebrews-12-1-2', title: 'Run with endurance', reference: 'Hebrews 12:1–2', verseCount: 2},
];

/**
 * Resolve one curated selection from lazy-loaded book packs. Saved ids and text
 * match the app's existing whole-passage lookup, so adding either is deduplicated.
 * The thematic title stays in the catalog; the item title is its Bible reference.
 */
export async function loadPassage(id: string, translation: PassageTranslation = 'BSB'): Promise<ContentItem> {
  const passage = passages.find(p => p.id === id);
  if (!passage) throw Error('Unknown passage.');
  if (!passageTranslations.includes(translation)) throw Error('Choose BSB, KJV, WEB, or ESV.');
  if (translation === 'ESV') return (await lookupEsvReference(passage.reference))[0];
  const verses = await lookupReference(passage.reference, translation);
  if (verses.length !== passage.verseCount || verses.some(v => !v.text.trim())) throw Error('The complete passage is unavailable.');
  const first = verses[0], last = verses[verses.length - 1];
  return {
    ...first,
    id: first.id + '--' + last.id,
    title: first.title + '–' + last.title.split(':').at(-1),
    reference: passage.reference,
    text: verses.map(v => v.text).join(' '),
  };
}

/** Load the complete catalog in its curated order, with one item per passage. */
export async function loadPassages(translation: PassageTranslation = 'BSB'): Promise<ContentItem[]> {
  return Promise.all(passages.map(p => loadPassage(p.id, translation)));
}
