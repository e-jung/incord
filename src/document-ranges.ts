import type {ContentCollection, ContentItem} from './content';
import type {Item} from './store';

export type DocumentRange = {start: number; end: number};
export type DocumentRangeMode = 'questions' | 'days' | 'whole';
export const isCreed = (document: ContentCollection) => ['apostles', 'nicene'].includes(document.id);
export const documentNumbers = (document: ContentCollection, mode: DocumentRangeMode = 'questions') =>
  [...new Set(document.items.map(item => mode === 'days' ? item.lordsDay : item.number).filter((n): n is number => n !== undefined))].sort((a,b) => a-b);

/** Inclusive source coordinates, never array offsets: all canonical answer parts survive. */
export function itemsInDocumentRange(document: ContentCollection, mode: DocumentRangeMode, range: DocumentRange): ContentItem[] {
  if (mode === 'whole') return document.items;
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start > range.end) return [];
  const numbers = documentNumbers(document, mode);
  if (!numbers.includes(range.start) || !numbers.includes(range.end)) return [];
  return document.items.filter(item => {
    const number = mode === 'days' ? item.lordsDay : item.number;
    return number !== undefined && number >= range.start && number <= range.end;
  });
}

/** Start at the first incomplete question. Heidelberg keeps complete Lord's Days together. */
export function nextDocumentRange(document: ContentCollection, live: Pick<Item, 'id' | 'deleted'>[], mode: DocumentRangeMode = 'questions'): DocumentRange {
  const ids = new Set(live.filter(item => !item.deleted).map(item => item.id));
  const missing = document.items.find(item => !ids.has(item.id));
  const numbers = documentNumbers(document, mode);
  const start = (mode === 'days' ? missing?.lordsDay : missing?.number) ?? numbers[0] ?? 1;
  if (mode === 'days') {
    const days = numbers.filter(day => day >= start);
    let end = start, distance = Infinity;
    for (const day of days) {
      const size = new Set(itemsInDocumentRange(document, 'days', {start, end: day}).map(item => item.number)).size;
      if (Math.abs(size - 12) < distance) { end = day; distance = Math.abs(size - 12); }
      if (size >= 12) break;
    }
    return {start, end};
  }
  return {start, end: numbers[Math.min(numbers.indexOf(start) + 11, numbers.length - 1)] ?? start};
}
