import { describe, expect, it } from 'vitest';
import { allowance, grade, maskWords, transition } from './ladder';
import { tokenize } from './tokenize';

const verse = 'In the beginning God created the heavens and the earth';
describe('masks', () => {
  it('uses one boolean per token, with none visible at step 4', () => {
    expect(maskWords(verse, 1)).toEqual(Array(10).fill(false));
    expect(maskWords(verse, 4)).toEqual(Array(10).fill(true));
    expect(maskWords(verse, 2).filter(Boolean)).toHaveLength(3);
    expect(maskWords(verse, 3).filter(Boolean)).toHaveLength(7);
  });
  it('is deterministic, nested, and covers all thirds without selecting only short words', () => {
    const text = 'a of everlasting a to righteousness a in faithfulness';
    const words = tokenize(text);
    const two = maskWords(text, 2);
    expect(two).toEqual(maskWords(text, 2));
    expect(words.filter((_, i) => two[i])).toEqual([
      'everlasting',
      'righteousness',
      'faithfulness',
    ]);
    const three = maskWords(text, 3);
    two.forEach((hidden, i) => {
      if (hidden) expect(three[i]).toBe(true);
    });
  });
  it('handles empty and tiny passages', () => {
    for (const step of [1, 2, 3, 4]) expect(maskWords('…', step)).toEqual([]);
    expect(maskWords('Jesus.', 2)).toEqual([true]);
    expect(maskWords('Jesus.', 3)).toEqual([true]);
    expect(maskWords('Jesus wept.', 2).filter(Boolean)).toHaveLength(1);
    expect(maskWords('Jesus wept.', 3).filter(Boolean)).toHaveLength(1);
  });
  it('breaks length ties by proximity to centre, preserving stable first ties', () => {
    expect(maskWords('aa bb cc', 2)).toEqual([false, true, false]);
    expect(maskWords('aa bb cc dd', 2)).toEqual([false, true, false, false]);
  });
  it('retains correct counts and nested masks across passage lengths', () => {
    for (let n = 1; n <= 150; n++) {
      const text = Array.from({ length: n }, (_, i) => (i % 2 ? 'everlasting' : 'a')).join(' ');
      const two = maskWords(text, 2);
      const three = maskWords(text, 3);
      expect(two.filter(Boolean)).toHaveLength(Math.max(1, Math.round(n / 3)));
      expect(three.filter(Boolean)).toHaveLength(Math.max(1, Math.round((n * 2) / 3)));
      two.forEach((hidden, i) => {
        if (hidden) expect(three[i]).toBe(true);
      });
    }
  });
  it.each([0, 5, -1, 2.5, NaN])('rejects invalid step %s', (step) =>
    expect(() => maskWords(verse, step)).toThrow(RangeError),
  );
});

describe('allowance', () => {
  it.each([
    [0, 1],
    [1, 1],
    [9, 1],
    [10, 1],
    [11, 1],
    [19, 1],
    [20, 2],
    [29, 2],
    [30, 3],
    [100, 10],
  ])('%i hidden permits %i', (hidden, expected) => expect(allowance(hidden)).toBe(expected));
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid counts %s',
    (hidden) => expect(() => allowance(hidden)).toThrow(RangeError),
  );
});

describe('grades', () => {
  it.each([
    [0, 40, 'Easy'],
    [0, 0, 'Easy'],
    [1, 1, 'Good'],
    [1, 10, 'Good'],
    [2, 20, 'Good'],
    [2, 10, 'Hard'],
    [5, 20, 'Hard'],
    [4, 19, 'Hard'],
    [3, 10, 'Again'],
    [6, 20, 'Again'],
    [5, 19, 'Again'],
    [2, 1, 'Again'],
  ] as const)('%i slips with %i hidden → %s', (slips, hidden, expected) =>
    expect(grade(slips, hidden)).toBe(expected),
  );
  it.each([-1, 1.5, NaN, Infinity])('rejects invalid slips %s', (slips) =>
    expect(() => grade(slips, 10)).toThrow(RangeError),
  );
});

describe('ladder transitions', () => {
  it('does not memory-score the type-along step', () =>
    expect(transition(1, 99, 0)).toEqual({ step: 2, learned: false, passed: true }));
  it('advances on the allowance boundary, repeating after it', () => {
    expect(transition(2, 1, 10)).toEqual({ step: 3, learned: false, passed: true });
    expect(transition(2, 2, 10)).toEqual({ step: 2, learned: false, passed: false });
    expect(transition(3, 2, 20)).toEqual({ step: 4, learned: false, passed: true });
    expect(transition(3, 3, 20)).toEqual({ step: 3, learned: false, passed: false });
  });
  it('only marks learned after passing the blank step', () => {
    expect(transition(4, 0, 20)).toEqual({ step: 4, learned: true, passed: true });
    expect(transition(4, 3, 20)).toEqual({ step: 4, learned: false, passed: false });
  });
  it('launches the I-know-this shortcut and fails back to step 3', () => {
    expect(transition(1, 0, 0, true)).toEqual({ step: 4, learned: false, passed: true });
    expect(transition(4, 2, 10, true)).toEqual({ step: 3, learned: false, passed: false });
    expect(transition(4, 1, 10, true)).toEqual({ step: 4, learned: true, passed: true });
  });
  it('ignores shortcut flags on intermediate steps', () =>
    expect(transition(2, 2, 10, true)).toEqual({ step: 2, learned: false, passed: false }));
  it('validates all inputs', () => {
    expect(() => transition(5, 0, 0)).toThrow(RangeError);
    expect(() => transition(1, -1, 0)).toThrow(RangeError);
    expect(() => transition(1, 0, -1)).toThrow(RangeError);
  });
});
