import { ESV_OFFLINE_MESSAGE } from '../shared/esv';
import { contentCopy } from './config/copy';
import {
  lookupReference as resolveReference,
  lookupEsvReference as resolveEsv,
  type BookPack,
  type Translation,
  type ContentItem,
} from '../shared/domain/catalog';
export {
  starters,
  documents,
  books,
  translations,
  type Translation,
  type ContentItem,
  type ContentCollection,
} from '../shared/domain/catalog';
const cache = new Map<string, Promise<BookPack>>();
export async function loadBook(id: string, translation: Translation): Promise<BookPack> {
  const key = `${translation.toLowerCase()}/${id}`;
  let promise = cache.get(key);
  if (!promise) {
    promise = fetch(`${import.meta.env.BASE_URL}content/${key}.json`)
      .then(async (response) => {
        if (!response.ok) throw Error(contentCopy.offline);
        return response.json() as Promise<BookPack>;
      })
      .catch(() => {
        cache.delete(key);
        throw Error(contentCopy.offline);
      });
    cache.set(key, promise);
  }
  return promise;
}

export function lookupReference(reference: string, translation = 'BSB'): Promise<ContentItem[]> {
  return resolveReference(reference, translation, loadBook, { messages: contentCopy });
}
export function lookupEsvReference(reference: string): Promise<ContentItem[]> {
  return resolveEsv(reference, loadBook, { messages: contentCopy });
}
export async function fetchEsvText(reference: string): Promise<string> {
  try {
    const response = await fetch('/api/esv?q=' + encodeURIComponent(reference), {
      cache: 'no-store',
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw Error(result?.error || ESV_OFFLINE_MESSAGE);
    }
    const text = await response.text();
    if (!text.trim()) throw Error(ESV_OFFLINE_MESSAGE);
    return text;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)
    )
      throw Error(ESV_OFFLINE_MESSAGE);
    throw error;
  }
}
/** Full wording checked against api.esv.org on 2026-11-13 (docs link to these usage terms). */
export const esvAttribution = {
  label: 'ESV',
  short: '(ESV)',
  url: 'https://www.esv.org',
  copyright:
    'Scripture quotations marked “ESV” are from the ESV® Bible (The Holy Bible, English St' +
    'andard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. ' +
    'Used by permission. All rights reserved. The ESV text may not be quoted in any public' +
    'ation made available to the public by a Creative Commons license. The ESV may not be ' +
    'translated into any other language. Users may not copy or download more than 500 vers' +
    'es of the ESV Bible or more than one half of any book of the ESV Bible.',
};
