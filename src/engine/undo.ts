/** Attempt-local history only: never contains stored items or review events. */
export type TapState = { position: number; slips: number[]; visualSlips: number[] };
export type TapUndo = { before: TapState; expiresAt: number };
export function applyPracticeTap(
  state: TapState,
  wrong: boolean,
  hidden: boolean,
  total: number,
  now: number,
): { state: TapState; undo: TapUndo | null } {
  const before = {
    position: state.position,
    slips: [...state.slips],
    visualSlips: [...state.visualSlips],
  };
  const next = {
    position: state.position + 1,
    slips: wrong && hidden ? [...state.slips, state.position] : [...state.slips],
    visualSlips: wrong ? [...state.visualSlips, state.position] : [...state.visualSlips],
  };
  return { state: next, undo: next.position < total ? { before, expiresAt: now + 2000 } : null };
}
/** Consuming the ticket (even an expired one) is the caller's responsibility. */
export function undoPracticeTap(state: TapState, ticket: TapUndo | null, now: number): TapState {
  if (!ticket || now >= ticket.expiresAt) return state;
  return {
    position: ticket.before.position,
    slips: [...ticket.before.slips],
    visualSlips: [...ticket.before.visualSlips],
  };
}
