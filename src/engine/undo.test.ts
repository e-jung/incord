import { describe, it, expect } from 'vitest';
import { applyPracticeTap, undoPracticeTap, type TapState } from './undo';
const initial: TapState = { position: 0, slips: [], visualSlips: [] };
describe('attempt-local tap undo', () => {
  it('restores a correct letter without mutating its input', () => {
    const tap = applyPracticeTap(initial, false, true, 3, 100);
    expect(tap.state).toEqual({ position: 1, slips: [], visualSlips: [] });
    expect(undoPracticeTap(tap.state, tap.undo, 2099)).toEqual(initial);
    expect(initial).toEqual({ position: 0, slips: [], visualSlips: [] });
  });
  it('restores both hidden-word slip counters after a wrong letter', () => {
    const tap = applyPracticeTap({ position: 1, slips: [0], visualSlips: [0] }, true, true, 4, 100);
    expect(tap.state).toEqual({ position: 2, slips: [0, 1], visualSlips: [0, 1] });
    const restored = undoPracticeTap(tap.state, tap.undo, 101);
    expect(restored).toEqual({ position: 1, slips: [0], visualSlips: [0] });
    restored.slips.push(9);
    expect(tap.undo!.before.slips).toEqual([0]);
  });
  it('does not score a visible-word slip', () => {
    const tap = applyPracticeTap(initial, true, false, 3, 100);
    expect(tap.state).toEqual({ position: 1, slips: [], visualSlips: [0] });
    expect(undoPracticeTap(tap.state, tap.undo, 101)).toEqual(initial);
  });
  it('only restores the last tap, not a chain of previous taps', () => {
    const first = applyPracticeTap(initial, true, true, 4, 100);
    const second = applyPracticeTap(first.state, false, false, 4, 200);
    expect(undoPracticeTap(second.state, second.undo, 201)).toEqual(first.state);
    expect(undoPracticeTap(first.state, null, 202)).toBe(first.state);
  });
  it('expires exactly at two seconds and cannot undo final completion', () => {
    const tap = applyPracticeTap(initial, false, false, 2, 100);
    expect(undoPracticeTap(tap.state, tap.undo, 2100)).toBe(tap.state);
    const final = applyPracticeTap(tap.state, true, true, 2, 200);
    expect(final.undo).toBeNull();
    expect(final.state.position).toBe(2);
    expect(undoPracticeTap(final.state, final.undo, 201)).toBe(final.state);
    expect(Object.keys(final)).toEqual(['state', 'undo']);
  });
});
