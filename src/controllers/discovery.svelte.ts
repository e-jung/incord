import * as stats from '../stats';

import { copy as ui } from '../config/copy';

import { tokenize } from '../engine';
import { starters, documents, lookupReference } from '../content';
import { passages, loadPassage } from '../passages';
import { topics, loadTopic } from '../topics';
import { ensureItemText, assertEsvLimit, addItems, type Item } from '../store';
import type { AppRuntime } from './state.svelte';

export function createDiscoveryController(
  vm: Pick<
    AppRuntime,
    | 'discoverFilter'
    | 'selectedDoc'
    | 'groupGoalError'
    | 'addMode'
    | 'found'
    | 'passageRequest'
    | 'loadingPassage'
    | 'clearAction'
    | 'actionNotes'
    | 'scriptureGeneration'
    | 'practiceLoadRequest'
    | 'preview'
    | 'confirmBatch'
    | 'data'
    | 'savePreference'
    | 'tab'
    | 'action'
    | 'live'
    | 'noteAction'
    | 'batchTimer'
    | 'batchAdded'
    | 'batchCollection'
    | 'addTarget'
    | 'save'
    | 'openCollection'
    | 'reference'
    | 'busy'
    | 'passageMode'
    | 'customTitle'
    | 'customText'
    | 'removeTarget'
    | 'undoItem'
    | 'undoTimer'
  >,
) {
  function filterDiscover(value: string) {
    clearPreviewNotes();
    vm.discoverFilter = value;
    try {
      sessionStorage.setItem('bh_discover_filter', value);
    } catch {}
    vm.selectedDoc = '';
    vm.groupGoalError = '';
    vm.addMode = ui.verseMode;
    vm.found = [];
    vm.passageRequest++;
    vm.loadingPassage = false;
    vm.clearAction('find');
    vm.clearAction('own');
    vm.clearAction('add');
  }
  function clearPreviewNotes() {
    for (const key of Object.keys(vm.actionNotes))
      if (/^(featured-|topic-|passage-|found-)/.test(key)) vm.clearAction(key);
  }
  function resetTranslationResults() {
    vm.scriptureGeneration++;
    clearPreviewNotes();
    vm.clearAction('find');
    vm.clearAction('add');
    if (vm.practiceLoadRequest !== vm.passageRequest) vm.loadingPassage = false;
    vm.found = [];
    if (vm.preview?.items.some((item: any) => item.translation)) vm.preview = null;
    if (vm.confirmBatch?.some((item) => item.translation)) vm.confirmBatch = null;
  }
  function changeTranslation(event: Event) {
    vm.data.settings.defaultTranslation = (event.currentTarget as HTMLSelectElement)
      .value as typeof vm.data.settings.defaultTranslation;
    resetTranslationResults();
    void vm.savePreference(vm.tab === ui.discover ? 'translation' : 'defaultTranslation');
  }
  async function add(
    items: any[],
    collectionId?: string,
    confirmed = false,
    largePassage = false,
    key = 'add',
  ) {
    let added = false;
    await vm.action(key, async () => {
      const count = items.filter((item) => !vm.live.some((i) => i.id === item.id)).length;
      const out = await addChecked(items, collectionId, confirmed, largePassage);
      if (out) {
        added = true;
        vm.noteAction(key, count ? ui.itemsAdded(count) : ui.alreadyAdded);
      }
    });
    return added;
  }
  async function addChecked(
    items: any[],
    collectionId?: string,
    confirmed = false,
    largePassage = false,
  ) {
    if ((items.length > 20 || largePassage) && !confirmed) {
      clearTimeout(vm.batchTimer);
      vm.clearAction('batch-add');
      vm.batchAdded = false;
      vm.confirmBatch = items;
      vm.batchCollection = collectionId;
      return;
    }
    const added = items.filter((item) => !vm.live.some((i) => i.id === item.id));
    const count = added.length;
    vm.data.items = addItems(vm.data.items, items, vm.addTarget || collectionId);
    if (count) {
      vm.data.queue.push(crypto.randomUUID());
      await vm.save();
      if (starters.some((s) => s.id === collectionId))
        stats.trackStats(`starter_added:${collectionId}`);
      else if (documents.some((d) => d.id === collectionId))
        stats.trackStats(`doc_items_added:${collectionId}`);
      else if (added.some((i) => i.translation))
        for (const code of new Set(added.map((i) => i.translation?.toLowerCase()).filter(Boolean)))
          stats.trackStats(`translation_added:${code}`);
      else stats.trackStats('own_text_added');
    }
    return true;
  }
  async function confirmBatchAdd() {
    if (!vm.confirmBatch || vm.batchAdded) return;
    const items = vm.confirmBatch;
    const ok = await add(items, vm.batchCollection, true, false, 'batch-add');
    if (ok && vm.confirmBatch === items) {
      vm.batchAdded = true;
      clearTimeout(vm.batchTimer);
      vm.batchTimer = setTimeout(() => {
        if (vm.confirmBatch === items) vm.confirmBatch = null;
      }, 3000);
    }
  }
  async function previewSelection(key: string, load: () => Promise<any>) {
    const request = ++vm.passageRequest,
      generation = vm.scriptureGeneration,
      target = vm.addTarget;
    const current = () => request === vm.passageRequest && generation === vm.scriptureGeneration;
    clearPreviewNotes();
    vm.loadingPassage = true;
    vm.clearAction(key);
    vm.actionNotes[key] = { text: ui.loadingPassage };
    try {
      const selection = await load();
      if (!current()) return;
      for (const item of selection.items) {
        if (!current()) return;
        await ensureItemText(item as Item);
      }
      if (current()) {
        vm.clearAction(key);
        vm.preview = { ...selection, id: target || selection.id };
      }
    } catch (e) {
      if (current()) vm.noteAction(key, e instanceof Error ? e.message : String(e), true);
    } finally {
      if (current()) vm.loadingPassage = false;
    }
  }
  async function previewPassage(id: string) {
    await previewSelection('passage-' + id, async () => {
      const item = await loadPassage(id, vm.data.settings.defaultTranslation);
      return {
        id: 'passages',
        title: item.reference || item.title,
        items: [item],
        goalSelection: { kind: 'passage', id, translation: vm.data.settings.defaultTranslation },
      };
    });
  }
  async function previewFeatured(id: string) {
    await previewSelection('featured-' + id, async () => {
      if (id === 'psalm23')
        return {
          id,
          title: 'Psalm 23',
          items: [await loadPassage('psalm-23', vm.data.settings.defaultTranslation)],
          goalSelection: {
            kind: 'passage',
            id: 'psalm-23',
            translation: vm.data.settings.defaultTranslation,
          },
        };
      const starter = starters.find((s) => s.id === id)!;
      const items =
        id === 'gospel'
          ? (
              await Promise.all(
                starter.items.map((item) =>
                  lookupReference(item.title, vm.data.settings.defaultTranslation),
                ),
              )
            ).flat()
          : starter.items;
      return {
        ...starter,
        items,
        goalSelection: { kind: 'starter', id, translation: vm.data.settings.defaultTranslation },
      };
    });
  }
  async function previewTopic(id: string) {
    await previewSelection('topic-' + id, async () => ({
      id: `topic-${id}`,
      title: topics.find((t) => t.id === id)!.title,
      items: await loadTopic(id, vm.data.settings.defaultTranslation),
      goalSelection: {
        kind: 'topic',
        id: `topic-${id}`,
        translation: vm.data.settings.defaultTranslation,
      },
    }));
  }
  async function previewFound(source: any) {
    await previewSelection('found-' + source.id, async () => ({
      id: 'bible',
      title: source.title,
      items: [{ ...source }],
    }));
  }
  async function addStarter(s: any) {
    vm.addTarget = '';
    if (await add(s.items, s.id, false, false, 'preview-add')) {
      vm.preview = null;
      vm.openCollection(s.id);
    }
  }
  async function search() {
    if (!vm.reference.trim() || vm.busy) return;
    clearPreviewNotes();
    vm.loadingPassage = false;
    const request = ++vm.passageRequest,
      generation = vm.scriptureGeneration,
      tr = vm.data.settings.defaultTranslation;
    const current = () => request === vm.passageRequest && generation === vm.scriptureGeneration;
    vm.found = [];
    vm.clearAction('find');
    vm.busy = true;
    try {
      const items = await lookupReference(vm.reference, tr);
      if (!current()) return;
      if (tr === 'ESV') await Promise.all(items.map((item) => ensureItemText(item as Item)));
      if (!current()) return;
      vm.found = items;
      if (!vm.found.length) throw Error(ui.noVersesFound);
      vm.passageMode =
        tokenize(vm.found.map((i) => i.text).join(' ')).length > 150 ? 'chunks' : 'passage';
    } catch (e) {
      if (current()) vm.noteAction('find', e instanceof Error ? e.message : String(e), true);
    } finally {
      vm.busy = false;
    }
  }
  async function own() {
    await vm.action('own', async () => {
      if (!vm.customTitle.trim() || !vm.customText.trim()) throw Error(ui.missingCustomText);
      const added = await addChecked([
        {
          id: crypto.randomUUID(),
          title: vm.customTitle.trim(),
          text: vm.customText.trim(),
          collection: ui.personalCollection,
        },
      ]);
      if (!added) return;
      vm.customTitle = ui.empty;
      vm.customText = ui.empty;
      vm.noteAction('own', ui.itemsAdded(1));
    });
  }
  async function remove(item: Item) {
    await vm.action('remove', async () => {
      const removed = { ...item, deleted: true, updatedAt: Date.now() };
      vm.data.items = vm.data.items.map((entry) => (entry.id === item.id ? removed : entry));
      await vm.save();
      vm.removeTarget = null;
      vm.undoItem = removed;
      clearTimeout(vm.undoTimer);
      vm.undoTimer = setTimeout(() => {
        if (vm.undoItem?.id === item.id) vm.undoItem = null;
      }, 3000);
    });
  }
  async function undo() {
    if (!vm.undoItem) return;
    await vm.action('undo', async () => {
      const revived = { ...vm.undoItem!, deleted: false, updatedAt: Date.now() };
      const proposed = vm.data.items.map((item) => (item.id === revived.id ? revived : item));
      assertEsvLimit(proposed);
      vm.data.items = proposed;
      vm.undoItem = null;
      await vm.save();
    });
  }
  function passageItems() {
    if (vm.passageMode === 'separate' || vm.found.length < 2) return vm.found;
    const groups =
      vm.passageMode === 'chunks'
        ? Array.from({ length: Math.ceil(vm.found.length / 4) }, (_, i) =>
            vm.found.slice(i * 4, i * 4 + 4),
          )
        : [vm.found];
    return groups.map((group) => ({
      ...group[0],
      id: group[0].id + '--' + group.at(-1).id,
      title:
        group[0].title +
        '–' +
        (group[0].title.split(':')[0] === group.at(-1).title.split(':')[0]
          ? group.at(-1).title.split(':').at(-1)
          : group.at(-1).title.split(' ').at(-1)),
      text: group.map((i) => i.text).join(' '),
    }));
  }
  return {
    filterDiscover,
    clearPreviewNotes,
    resetTranslationResults,
    changeTranslation,
    add,
    addChecked,
    confirmBatchAdd,
    previewSelection,
    previewPassage,
    previewFeatured,
    previewTopic,
    previewFound,
    addStarter,
    search,
    own,
    remove,
    undo,
    passageItems,
  };
}
