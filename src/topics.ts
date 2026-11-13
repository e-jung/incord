import {lookupReference, lookupEsvReference, translations, type ContentItem, type Translation} from './content';

import {topics} from '../shared/topics';
export {topics,type TopicMetadata} from '../shared/topics';

/** One canonical Bible item per verse; topic membership never changes verse ids. */
export async function loadTopic(id: string, translation: Translation = 'BSB'): Promise<ContentItem[]> {
  const topic = topics.find(candidate => candidate.id === id);
  if (!topic) throw Error('Unknown topic.');
  if (!translations.includes(translation)) throw Error('Choose BSB, KJV, WEB, or ESV.');
  const verses = (await Promise.all(topic.references.map(reference =>
    lookupReference(reference, translation === 'ESV' ? 'BSB' : translation),
  ))).flat();
  if (verses.length !== topic.verseCount || verses.some(verse => !verse.text.trim())) {
    throw Error('The complete topic is unavailable.');
  }
  // ESV range lookups produce a single passage item. Expand BSB coordinates first
  // and resolve EACH verse separately, without requesting any publisher text.
  const items = translation === 'ESV'
    ? (await Promise.all(verses.map(verse => lookupEsvReference(verse.title)))).flat()
    : verses;
  return items.map(item => ({...item, collection: `topic-${topic.id}`}));
}
