import { copy as ui } from '../config/copy';

import type { AppRuntime } from './state.svelte';

export function createActionsController(
  vm: Pick<
    AppRuntime,
    | 'actionTimers'
    | 'actionNotes'
    | 'runningActions'
    | 'busyActions'
    | 'busy'
    | 'save'
    | 'error'
    | 'message'
  >,
) {
  function clearAction(key: string) {
    clearTimeout(vm.actionTimers.get(key));
    vm.actionTimers.delete(key);
    delete vm.actionNotes[key];
  }
  function noteAction(key: string, text: string, error = false) {
    clearAction(key);
    vm.actionNotes[key] = { text, error };
    if (!error)
      vm.actionTimers.set(
        key,
        setTimeout(() => clearAction(key), 3000),
      );
  }
  async function action(key: string, fn: () => Promise<unknown>, success?: string) {
    if (vm.runningActions.has(key)) return;
    vm.runningActions.add(key);
    clearAction(key);
    vm.busyActions++;
    vm.busy = true;
    try {
      await fn();
      if (success) noteAction(key, success);
    } catch (e) {
      noteAction(key, e instanceof Error ? e.message : String(e), true);
    } finally {
      vm.runningActions.delete(key);
      vm.busyActions--;
      vm.busy = vm.busyActions > 0;
    }
  }
  async function savePreference(key: string) {
    await action(key, vm.save, ui.preferenceSaved);
  }
  async function attempt(fn: () => Promise<void>) {
    vm.busy = true;
    vm.error = ui.empty;
    vm.message = ui.empty;
    try {
      await fn();
    } catch (e) {
      vm.error = e instanceof Error ? e.message : String(e);
    } finally {
      vm.busy = false;
    }
  }
  return { clearAction, noteAction, action, savePreference, attempt };
}
