import { RULES } from '../config/rules';

/** rampDay is zero-based: day 0 starts at 3; day 6 restores the normal load. */
export function gentleCap(daysAway: number, rampDay: number, normal: number): number {
  if (![daysAway, rampDay, normal].every((v) => Number.isFinite(v) && v >= 0))
    throw new RangeError('daysAway, rampDay, and normal must be finite and non-negative');
  normal = Math.floor(normal);
  if (daysAway < RULES.gentleReturn.afterDays) return normal;
  const start = Math.min(RULES.gentleReturn.initialCap, normal);
  const progress =
    Math.min(Math.floor(rampDay), RULES.gentleReturn.rampDays - 1) /
    (RULES.gentleReturn.rampDays - 1);
  return Math.round(start + (normal - start) * progress);
}

export interface DueItem {
  id: string;
  /** Unlearned items are always eligible, irrespective of a future due date. */
  learned: boolean;
  due?: Date | string | number | null;
  learnedAt?: Date | string | number | null;
  createdAt?: Date | string | number | null;
}
function timestamp(value: DueItem['due'], fallback: number): number {
  if (value == null) return fallback;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : fallback;
}

/** No mutation. Returning users see oldest-known reviews first, not a backlog count. */
export function dueItems<T extends DueItem>(
  items: readonly T[],
  now: Date,
  options: { daysAway?: number; rampDay?: number; normal?: number } = {},
): T[] {
  const time = now.getTime();
  if (!Number.isFinite(time)) throw new RangeError('now must be a valid Date');
  const { daysAway = 0, rampDay = 0, normal = RULES.daily.normalCap } = options;
  const cap = gentleCap(daysAway, rampDay, normal);
  const returning = daysAway >= RULES.gentleReturn.afterDays;
  const candidates = items.filter((item) => !item.learned || timestamp(item.due, Infinity) <= time);
  candidates.sort((a, b) => {
    // During a gentle return, familiar material precedes new learning.
    if (returning && a.learned !== b.learned) return a.learned ? -1 : 1;
    const primary = returning
      ? timestamp(a.learnedAt ?? a.createdAt, Infinity) -
        timestamp(b.learnedAt ?? b.createdAt, Infinity)
      : timestamp(a.due, -Infinity) - timestamp(b.due, -Infinity);
    return (Number.isNaN(primary) ? 0 : primary) || a.id.localeCompare(b.id, 'en');
  });
  return candidates.slice(0, cap);
}
