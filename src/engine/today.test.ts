import { describe, expect, it } from 'vitest';
import { dueItems, gentleCap, type DueItem } from './today';
const now = new Date('2026-11-13T09:00:00Z');

describe('gentle return cap', () => {
  it('starts at 7 days away, not before', () => {
    expect(gentleCap(6, 0, 10)).toBe(10);
    expect(gentleCap(7, 0, 10)).toBe(3);
    expect(gentleCap(700, 0, 10)).toBe(3);
  });
  it('ramps to normal across seven zero-based days, then stays there', () => {
    expect(Array.from({ length: 9 }, (_, day) => gentleCap(7, day, 10))).toEqual([
      3, 4, 5, 7, 8, 9, 10, 10, 10,
    ]);
  });
  it('never increases a normal cap below 3 or returns fractional item counts', () => {
    expect(gentleCap(7, 0, 2)).toBe(2);
    expect(gentleCap(7, 0, 0)).toBe(0);
    expect(gentleCap(7, 6, 10.9)).toBe(10);
    expect(gentleCap(7, 1.5, 10)).toBe(4);
  });
  it.each([-1, NaN, Infinity])('validates all arguments: %s', (value) => {
    expect(() => gentleCap(value, 0, 10)).toThrow(RangeError);
    expect(() => gentleCap(7, value, 10)).toThrow(RangeError);
    expect(() => gentleCap(7, 0, value)).toThrow(RangeError);
  });
});

describe('due item selection', () => {
  const items: DueItem[] = [
    { id: 'recent', learned: true, due: '2026-11-10', learnedAt: '2026-10-01' },
    { id: 'old', learned: true, due: '2026-11-12', learnedAt: '2026-01-01' },
    { id: 'future', learned: true, due: '2027-01-01', learnedAt: '2025-01-01' },
    { id: 'new', learned: false },
    { id: 'invalid', learned: true, due: 'invalid' },
    { id: 'missing', learned: true },
    { id: 'now', learned: true, due: now, createdAt: '2026-02-01' },
  ];
  it('includes due-now reviews and unlearned items, excludes future/missing/invalid review dates', () => {
    expect(dueItems(items, now).map((i) => i.id)).toEqual(['new', 'recent', 'old', 'now']);
  });
  it('returns oldest-known first and caps gentle-return load', () => {
    expect(dueItems(items, now, { daysAway: 7 }).map((i) => i.id)).toEqual([
      'old',
      'now',
      'recent',
    ]);
    expect(dueItems(items, now, { daysAway: 7, rampDay: 6 }).map((i) => i.id)).toEqual([
      'old',
      'now',
      'recent',
      'new',
    ]);
  });
  it('puts familiar items ahead of new ones regardless of input ordering', () => {
    expect(
      dueItems(
        [
          { id: 'new', learned: false },
          { id: 'old', learned: true, due: 0 },
        ],
        now,
        { daysAway: 7 },
      ).map((i) => i.id),
    ).toEqual(['old', 'new']);
  });
  it('does not mutate arrays or items', () => {
    const before = structuredClone(items);
    dueItems(items, now, { daysAway: 7 });
    expect(items).toEqual(before);
  });
  it('honours ordinary caps and handles empty lists', () => {
    expect(dueItems(items, now, { normal: 1 }).map((i) => i.id)).toEqual(['new']);
    expect(dueItems(items, now, { normal: 0 })).toEqual([]);
    expect(dueItems([], now)).toEqual([]);
  });
  it('treats never-learned items as eligible even with future dates', () => {
    expect(dueItems([{ id: 'x', learned: false, due: '2027-01-01' }], now)).toHaveLength(1);
  });
  it('uses stable id ties and preserves extra caller fields', () => {
    const tied = [
      { id: 'b', learned: false, title: 'B' },
      { id: 'a', learned: false, title: 'A' },
    ];
    expect(dueItems(tied, now).map((i) => i.title)).toEqual(['A', 'B']);
    expect(dueItems(tied, now, { daysAway: 7 }).map((i) => i.id)).toEqual(['a', 'b']);
  });
  it('supports epoch dates and validates explicit now', () => {
    expect(dueItems([{ id: 'x', learned: true, due: 0 }], now)).toHaveLength(1);
    expect(() => dueItems([], new Date('invalid'))).toThrow(RangeError);
  });
});
