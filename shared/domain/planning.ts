import { sortItems, type OrderedItem } from './ordering';
export interface PlanningItem extends OrderedItem {
  learned: boolean;
  due: string;
}
export interface PlanningEvent {
  itemId: string;
  at: string;
  mode?: string;
}
/** Reviews are not charged to the daily new/learning allowance. Completed new
 * items still consume today's slots, so finishing one doesn't introduce another. */
export function dailyPlan<T extends PlanningItem>(
  items: readonly T[],
  events: readonly PlanningEvent[],
  date: string,
  newLimit: number,
  now: number,
  returnCap = Infinity,
  timeZone?: string,
): T[] {
  const practiced = new Set(
    events
      .filter(
        (e) =>
          new Date(e.at).toLocaleDateString('en-CA', { timeZone }) === date && e.mode !== 'review',
      )
      .map((e) => e.itemId),
  );
  const completed = items.filter((i) => i.learned && practiced.has(i.id)).length;
  const reviews = sortItems(items.filter((i) => i.learned && Date.parse(i.due) <= now)).sort(
    (a, b) => Date.parse(a.due) - Date.parse(b.due),
  );
  const learning = sortItems(items.filter((i) => !i.learned)).slice(
    0,
    Math.max(0, newLimit - completed),
  );
  return [...reviews, ...learning].slice(0, returnCap);
}
