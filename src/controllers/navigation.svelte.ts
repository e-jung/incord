import type { GroupGoalSelection, GroupAttention } from './types';

import { copy as ui } from '../config/copy';

import { topics } from '../topics';
import { api } from '../store';
import type { AppRuntime } from './state.svelte';

export function createNavigationController(
  vm: Pick<
    AppRuntime,
    | 'returnToGroups'
    | 'attentionRequest'
    | 'attentionUpdated'
    | 'groupAttention'
    | 'attentionAccount'
    | 'initialGroupId'
    | 'pendingGroupCode'
    | 'goalTarget'
    | 'groupGoalError'
    | 'filterDiscover'
    | 'groupGoalBusy'
    | 'preview'
    | 'undoItem'
    | 'undoTimer'
    | 'practice'
    | 'tab'
    | 'clearPreviewNotes'
    | 'passageRequest'
    | 'loadingPassage'
    | 'addTarget'
    | 'detail'
    | 'error'
    | 'message'
  >,
) {
  function signInForGroups() {
    vm.returnToGroups = true;
    try {
      sessionStorage.setItem('bh_groups_return', '1');
    } catch {}
    navigate(ui.account);
  }
  function setGroupAttention(value?: GroupAttention) {
    vm.attentionRequest++;
    vm.attentionUpdated = Date.now();
    vm.groupAttention = value || null;
  }
  async function refreshGroupAttention(force = false) {
    const id = vm.attentionAccount;
    if (!id || (!force && Date.now() - vm.attentionUpdated < 30000)) return;
    vm.attentionUpdated = Date.now();
    const request = ++vm.attentionRequest;
    try {
      const out = await api('/groups');
      if (request === vm.attentionRequest && vm.attentionAccount === id)
        setGroupAttention(out.attention);
    } catch {
      if (request === vm.attentionRequest)
        vm.attentionUpdated = 0; /* Group errors are shown locally when Groups is opened. */
    }
  }
  function openGroupAttention() {
    vm.initialGroupId = vm.groupAttention?.groupId || '';
    navigate(ui.groups.heading);
  }
  function joinedGroup() {
    vm.pendingGroupCode = '';
    try {
      sessionStorage.removeItem('bh_group_join');
    } catch {}
    if (location.pathname.startsWith('/join/')) history.replaceState(history.state, '', '/');
  }
  function chooseGroupGoal(id: string) {
    vm.initialGroupId = id;
    vm.goalTarget = id;
    vm.groupGoalError = '';
    navigate(ui.discover);
    vm.filterDiscover(ui.topics);
  }
  async function setGroupGoal(selection: GroupGoalSelection) {
    if (!vm.goalTarget || vm.groupGoalBusy) return;
    vm.groupGoalBusy = true;
    vm.groupGoalError = '';
    try {
      await api('/groups/' + encodeURIComponent(vm.goalTarget) + '/goal', { selection });
      vm.initialGroupId = vm.goalTarget;
      vm.goalTarget = '';
      vm.preview = null;
      navigate(ui.groups.heading);
    } catch (e) {
      vm.groupGoalError = e instanceof Error ? e.message : ui.groupGoalError;
    } finally {
      vm.groupGoalBusy = false;
    }
  }
  function initialGroupsRoute() {
    return !!vm.pendingGroupCode || location.pathname.startsWith('/join/');
  }
  function clearToasts() {
    vm.undoItem = null;
    clearTimeout(vm.undoTimer);
  }
  function pushView() {
    clearToasts();
    const view = { byheart: true, tab: vm.tab, detail: vm.detail, practice: !!vm.practice };
    if (history.state?.sheet) history.replaceState(view, '');
    else history.pushState(view, '');
    window.scrollTo(0, 0);
  }
  function openDiscoverAdd() {
    vm.goalTarget = '';
    vm.groupGoalError = '';
    navigate(ui.discover);
    vm.filterDiscover(ui.addYourOwn);
  }
  function abandonGroupSignin(to: string) {
    if (vm.tab === ui.account && to !== ui.account && vm.returnToGroups) {
      vm.returnToGroups = false;
      try {
        sessionStorage.removeItem('bh_groups_return');
      } catch {}
    }
  }
  function navigate(to: string) {
    abandonGroupSignin(to);
    vm.clearPreviewNotes();
    vm.passageRequest++;
    vm.loadingPassage = false;
    vm.addTarget = '';
    vm.tab = to;
    vm.detail = '';
    vm.error = '';
    vm.message = '';
    pushView();
  }
  function openCollection(id: string) {
    vm.passageRequest++;
    vm.loadingPassage = false;
    vm.addTarget = '';
    vm.tab = ui.library;
    vm.detail = id;
    pushView();
  }
  return {
    signInForGroups,
    setGroupAttention,
    refreshGroupAttention,
    openGroupAttention,
    joinedGroup,
    chooseGroupGoal,
    setGroupGoal,
    initialGroupsRoute,
    clearToasts,
    pushView,
    openDiscoverAdd,
    abandonGroupSignin,
    navigate,
    openCollection,
  };
}
