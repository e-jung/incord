/** Shared count grammar and display metadata; never expose storage keys. */
import {documents, starters} from '../content';
export const plural = (count: number, singular: string, multiple = `${singular}s`) => `${count} ${count === 1 ? singular : multiple}`;
export const practiceCount = (count: number) => `${plural(count, 'to practice', 'to practice')}`;
export const minutes = (count: number) => `About ${plural(count, 'min', 'min')}`;
type SourceItem = {id: string; collection: string; translation?: string};
export function sourceLabel(item: SourceItem): string {
  if (item.translation) return item.translation;
  const doc = documents.find(d => d.items.some(i => i.id === item.id));
  if (doc) {
    const entry = doc.items.find(i => i.id === item.id)!;
    return doc.title + (entry.number ? ` · Q${entry.number}` : '');
  }
  return 'Your text';
}
export function collectionColor(item: SourceItem): string {
  const index = starters.findIndex(s => s.id === item.collection || s.items.some(i => i.id === item.id));
  return `var(--c${index < 0 ? (item.collection === 'personal' ? 5 : 1) : index + 1})`;
}
