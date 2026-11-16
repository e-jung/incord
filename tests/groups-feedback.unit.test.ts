import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the component-owned lifecycle helpers without exposing a test-only API.
const source = readFileSync(new URL('../src/components/Groups.svelte', import.meta.url), 'utf8');
function feedback() {
  const helpers = source.slice(
    source.indexOf('const clearNote ='),
    source.indexOf('const current ='),
  );
  const javascript = ts.transpileModule(
    `
 let notes:Record<string,any>={},pendingReceipts={},copyRequest=0,confirmation:any=null,alive=true;
 const noteTimers=new Map<string,ReturnType<typeof setTimeout>>();
 ${helpers}
 return {message,clearNote,clearNotes,revealFeedback,notes:()=>notes,
 confirm:()=>confirmation,finish:()=>{confirmation={done:true}}};
 `,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return new Function('tick', 'window', 'getComputedStyle', javascript)(
    () => Promise.resolve(),
    { innerHeight: 800 },
    () => ({ overflowY: 'visible' }),
  ) as {
    message: (key: string, text: string, error?: boolean, persistent?: boolean) => void;
    clearNote: (key: string) => void;
    clearNotes: () => void;
    notes: () => Record<string, { text: string; error: boolean }>;
    finish: () => void;
    confirm: () => unknown;
    revealFeedback: (
      node: unknown,
      note: unknown,
    ) => { update: (note: unknown) => void; destroy: () => void };
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('Groups action feedback lifecycle', () => {
  it('dismisses success after three seconds but retains errors and pending instructions', () => {
    vi.useFakeTimers();
    const f = feedback();
    f.message('invite', 'Ready');
    f.message('goal', 'Try again', true);
    f.message('join', 'Waiting for approval', false, true);
    vi.advanceTimersByTime(2999);
    expect(f.notes().invite.text).toBe('Ready');
    vi.advanceTimersByTime(1);
    expect(f.notes().invite).toBeUndefined();
    expect(Object.keys(f.notes())).toEqual(['goal', 'join']);
  });
  it('gives a repeated action its own full duration and never clears a newer error', () => {
    vi.useFakeTimers();
    const f = feedback();
    f.message('copy', 'Copied');
    vi.advanceTimersByTime(2000);
    f.message('copy', 'Copied again');
    vi.advanceTimersByTime(1000);
    expect(f.notes().copy.text).toBe('Copied again');
    f.message('copy', 'Copy failed', true);
    vi.advanceTimersByTime(5000);
    expect(f.notes().copy.error).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans timers on reset/unmount and keeps confirmation receipts beside their action until expiry', () => {
    vi.useFakeTimers();
    const f = feedback();
    f.finish();
    f.message('confirm', 'Removed');
    vi.advanceTimersByTime(2999);
    expect(f.confirm()).toEqual({ done: true });
    vi.advanceTimersByTime(1);
    expect(f.confirm()).toBeNull();
    f.message('invite', 'Ready');
    f.message('weekly', 'Saved');
    f.clearNotes();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.notes()).toEqual({});
  });
  it('does not scroll visible feedback and reveals clipped feedback with nearest alignment', async () => {
    const f = feedback(),
      scrollIntoView = vi.fn();
    const node = {
      isConnected: true,
      parentElement: null,
      getBoundingClientRect: () => ({ top: 100, bottom: 130 }),
      scrollIntoView,
    };
    const action = f.revealFeedback(node, { text: 'Saved' });
    await Promise.resolve();
    expect(scrollIntoView).not.toHaveBeenCalled();
    node.getBoundingClientRect = () => ({ top: 790, bottom: 830 });
    action.update({ text: 'Saved again' });
    await Promise.resolve();
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant',
    });
  });
  it('reopens a collapsed action owner before measuring feedback', async () => {
    class Details {
      open = false;
      parentElement = null;
    }
    vi.stubGlobal('HTMLDetailsElement', Details);
    const owner = new Details(),
      scrollIntoView = vi.fn();
    feedback().revealFeedback(
      {
        isConnected: true,
        parentElement: owner,
        getBoundingClientRect: () => ({ top: 100, bottom: 130 }),
        scrollIntoView,
      },
      { text: 'Saved' },
    );
    await Promise.resolve();
    expect(owner.open).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
  it('cancels a queued reveal when its feedback is removed', async () => {
    const f = feedback(),
      scrollIntoView = vi.fn();
    const action = f.revealFeedback(
      {
        isConnected: true,
        parentElement: null,
        getBoundingClientRect: () => ({ top: 900, bottom: 930 }),
        scrollIntoView,
      },
      { text: 'Saved' },
    );
    action.destroy();
    await Promise.resolve();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
