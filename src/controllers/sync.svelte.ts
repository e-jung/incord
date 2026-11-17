import { copy as ui } from '../config/copy';

import { persist, api, mergeItems, mergeSettings, stampSettings } from '../store';
import type { AppRuntime } from './state.svelte';

export function createSyncController(
  vm: Pick<
    AppRuntime,
    | 'data'
    | 'feedback'
    | 'savedSettings'
    | 'account'
    | 'mergePrompt'
    | 'awaitingCodeSave'
    | 'syncing'
    | 'syncAgain'
    | 'attentionDirty'
    | 'online'
    | 'message'
    | 'refreshGroupAttention'
    | 'error'
  >,
) {
  const syncWaiters: (() => void)[] = [];
  function theme() {
    document.documentElement.dataset.theme = vm.data.settings.theme;
    document.documentElement.dataset.textSize = vm.data.settings.textSize || 'default';
  }
  async function save() {
    vm.feedback.setSettings(vm.data.settings);
    vm.data.settings = stampSettings($state.snapshot(vm.data.settings), vm.savedSettings);
    vm.savedSettings = structuredClone($state.snapshot(vm.data.settings));
    vm.data.account = vm.account;
    vm.data.settings = await persist($state.snapshot(vm.data));
    vm.savedSettings = structuredClone($state.snapshot(vm.data.settings));
    theme();
    if (vm.account && !vm.mergePrompt) void sync();
  }
  async function sync() {
    const userAtStart = vm.account;
    if (!userAtStart || vm.mergePrompt || vm.awaitingCodeSave) return;
    if (vm.syncing) {
      vm.syncAgain = true;
      return new Promise<void>((resolve) => syncWaiters.push(resolve));
    }
    vm.syncing = true;
    const refreshAttention = vm.attentionDirty;
    vm.attentionDirty = false;
    try {
      const items = $state.snapshot(vm.data.items),
        events = $state.snapshot(vm.data.events);
      let out: any;
      const batches = Math.max(1, Math.ceil(items.length / 500), Math.ceil(events.length / 1000));
      for (let n = 0; n < batches; n++)
        out = await api(ui.syncPath, {
          items: items.slice(n * 500, (n + 1) * 500),
          events: events.slice(n * 1000, (n + 1) * 1000),
          settings: $state.snapshot(vm.data.settings),
        });
      if (vm.account?.id !== userAtStart.id) return;
      vm.data.items = mergeItems(vm.data.items, out.items || []);
      vm.data.settings = stampSettings($state.snapshot(vm.data.settings), vm.savedSettings);
      if (out.settings) vm.data.settings = mergeSettings(vm.data.settings, out.settings);
      vm.savedSettings = structuredClone($state.snapshot(vm.data.settings));
      theme();
      const map = new Map(vm.data.events.map((e) => [e.id, e]));
      for (const e of out.events || []) map.set(e.id, e);
      vm.data.events = [...map.values()];
      vm.data.queue = [];
      vm.online = true;
      await persist($state.snapshot(vm.data));
      if (vm.message === ui.savedOffline) vm.message = ui.empty;
      if (refreshAttention) void vm.refreshGroupAttention(true);
    } catch (e) {
      if (refreshAttention && vm.account?.id === userAtStart.id) vm.attentionDirty = true;
      vm.online = false;
      if (e instanceof Error && /ESV/.test(e.message)) vm.error = e.message;
      vm.message = ui.savedOffline;
    } finally {
      vm.syncing = false;
      if (vm.syncAgain) {
        vm.syncAgain = false;
        if (vm.account && !vm.mergePrompt) await sync();
      }
      if (!vm.syncing) for (const resolve of syncWaiters.splice(0)) resolve();
    }
  }
  async function saveGroupName(name: string) {
    if (!vm.account || vm.mergePrompt || vm.awaitingCodeSave)
      throw new Error(ui.groups.nameSaveFailed);
    vm.data.settings.name = name;
    await save();
    await sync();
    if (!vm.online) throw new Error(ui.groups.nameSaveFailed);
  }
  return { theme, save, sync, saveGroupName };
}
