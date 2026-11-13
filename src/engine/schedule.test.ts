import { describe, expect, it } from 'vitest';
import { fsrs, Rating, State } from 'ts-fsrs';
import { RULES } from '../config/rules';
import { createEmptyCard, schedule } from './schedule';
import type { Grade } from './ladder';
const now = new Date('2026-11-13T09:00:00Z');

describe('FSRS scheduler', () => {
  it.each(['Easy', 'Good', 'Hard', 'Again'] as const)('delegates %s to pinned FSRS without fuzz', grade => {
    const card = createEmptyCard(now);
    const before = structuredClone(card);
    const expected = fsrs({ request_retention: RULES.scheduler.retention, maximum_interval: RULES.scheduler.maximumInterval, enable_short_term: false, enable_fuzz: false }).next(card, now, Rating[grade]);
    const result = schedule(card, grade, now);
    expect(result).toEqual(expected);
    expect(result.log.rating).toBe(Rating[grade]);
    expect(result.log.review).toEqual(now);
    expect(result.card.due.getTime()).toBeGreaterThan(now.getTime());
    expect(card).toEqual(before);
    expect(schedule(card, grade, now)).toEqual(result);
  });
  it('schedules the completed ladder in days, not short-term learning minutes', () => {
    const day = 86_400_000;
    for (const grade of ['Again', 'Hard', 'Good', 'Easy'] as const) {
      expect(schedule(null, grade, now).card.due.getTime() - now.getTime()).toBeGreaterThanOrEqual(day);
    }
    const good = schedule(null, 'Good', now).card;
    expect(good.scheduled_days).toBeGreaterThanOrEqual(2);
    expect(good.scheduled_days).toBeLessThanOrEqual(3);
    expect(schedule(null, 'Easy', now).card.scheduled_days).toBeGreaterThan(good.scheduled_days);
  });
  it('initializes a new card with an explicit clock', () => {
    expect(schedule(null, 'Good', now)).toEqual(schedule(createEmptyCard(now), 'Good', now));
    expect(schedule(undefined, 'Good', now)).toEqual(schedule(null, 'Good', now));
  });
  it('accepts serialized IndexedDB/export dates', () => {
    const card = schedule(null, 'Easy', now).card;
    const date = card.due;
    const jsonCard = JSON.parse(JSON.stringify(card));
    expect(schedule(jsonCard, 'Good', date)).toEqual(schedule(card, 'Good', date));
  });
  it('replays append-only events and increments reps without imposing a monthly cap', () => {
    let card = schedule(null, 'Easy', now).card;
    const events: { grade: Grade; now: Date }[] = [];
    for (let i = 0; i < 8; i++) {
      events.push({ grade: 'Easy', now: card.due });
      card = schedule(card, 'Easy', card.due).card;
    }
    expect(card.reps).toBe(9);
    expect(card.state).toBe(State.Review);
    expect(card.scheduled_days).toBeGreaterThan(30);
    let replay = schedule(null, 'Easy', now).card;
    for (const event of events) replay = schedule(replay, event.grade, event.now).card;
    expect(replay).toEqual(card);
  });
  it('records a lapse for a failed review', () => {
    const learned = schedule(null, 'Easy', now).card;
    const failed = schedule(learned, 'Again', learned.due);
    expect(failed.card.lapses).toBe(1);
    expect(failed.log.rating).toBe(Rating.Again);
  });
  it('rejects invalid dates and runtime grades', () => {
    expect(() => schedule(null, 'Easy', new Date('bad'))).toThrow(RangeError);
    expect(() => schedule(null, 'Manual' as Grade, now)).toThrow(RangeError);
    expect(() => schedule(null, 'toString' as Grade, now)).toThrow(RangeError);
  });
});
