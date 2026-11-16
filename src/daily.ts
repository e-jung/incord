import { type Item, type ReviewEvent } from './store';
import { tokenize } from './engine';
import { dailyPlan as plan } from '../shared/domain/planning';
export function dailyPlan(
  items: Item[],
  events: ReviewEvent[],
  date: string,
  newLimit = 3,
  now = Date.now(),
  returnCap = Infinity,
  timeZone?: string,
): Item[] {
  return plan(items, events, date, newLimit, now, returnCap, timeZone);
}
export function estimateMinutes(items: Item[]): number {
  return Math.max(
    1,
    Math.round(
      items.reduce((n, i) => n + tokenize(i.text).length * (i.learned ? 1 : 5 - i.step) * 1.2, 0) /
        60,
    ),
  );
}
