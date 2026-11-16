import { books, documents } from './catalog';
export interface OrderedItem {
  id: string;
  title: string;
  collection?: string;
  translation?: string;
  number?: number;
  part?: number;
  createdAt?: string;
  updatedAt?: number;
  order?: number;
}
const bookOrder = new Map(
  books.map((book, index) => [book.name.toLowerCase().replace(/s$/, ''), index]),
);
export function canonical(item: OrderedItem): (string | number)[] {
  const match = (item.title || '').match(/^(.+?) (\d+)(?::(\d+))?/);
  const book = match ? bookOrder.get(match[1].toLowerCase().replace(/s$/, '')) : undefined;
  if (
    book !== undefined &&
    (item.translation || item.collection === 'bible' || /^(bsb|kjv|web)-/.test(item.id))
  )
    return [0, book, Number(match![2]), Number(match![3] || 0)];
  const docIndex = documents.findIndex((d) => d.items.some((i) => i.id === item.id));
  if (docIndex >= 0) {
    const source = documents[docIndex].items.find((i) => i.id === item.id)!;
    return [1, docIndex, source.number || 0, source.part || 0];
  }
  const question = item.number || 0;
  if (question) return [1, documents.length, question, item.part || 0];
  return [2, item.createdAt || new Date(item.updatedAt || 0).toISOString(), item.order || 0];
}
export function canonicalCompare(a: OrderedItem, b: OrderedItem): number {
  const x = canonical(a),
    y = canonical(b);
  for (let n = 0; n < Math.max(x.length, y.length); n++) {
    if (x[n] !== y[n])
      return typeof x[n] === 'number' && typeof y[n] === 'number'
        ? Number(x[n]) - Number(y[n])
        : String(x[n]).localeCompare(String(y[n]));
  }
  return a.id.localeCompare(b.id);
}
export function sortItems<T extends OrderedItem>(items: readonly T[]): T[] {
  return [...items].sort(canonicalCompare);
}
