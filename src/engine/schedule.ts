import {
  createEmptyCard,
  fsrs,
  Rating,
  type Card,
  type CardInput,
  type RecordLogItem,
} from 'ts-fsrs';
import { RULES } from '../config/rules';
import type { Grade } from './ladder';
export { createEmptyCard };
export type { Card, CardInput, RecordLogItem };

const ratings = {
  Easy: Rating.Easy,
  Good: Rating.Good,
  Hard: Rating.Hard,
  Again: Rating.Again,
} as const;
const scheduler = fsrs({
  request_retention: RULES.scheduler.retention,
  maximum_interval: RULES.scheduler.maximumInterval,
  enable_short_term: false,
  enable_fuzz: RULES.scheduler.fuzz,
});

/** Explicit clock, no randomness: append the returned log to replay reviews. */
export function schedule(
  card: Card | CardInput | null | undefined,
  grade: Grade,
  now: Date,
): RecordLogItem {
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid Date');
  if (!Object.hasOwn(ratings, grade)) throw new RangeError('unknown review grade');
  return scheduler.next(card ?? createEmptyCard(now), now, ratings[grade]);
}
