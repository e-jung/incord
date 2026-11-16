import type { ConnectedApp } from './types';
import { forgetDeviceSignInCode } from '../sign-in-code';

import * as stats from '../stats';

import { copy as ui } from '../config/copy';

import { persist, api, clearStore, defaults } from '../store';
import type { AppRuntime } from './state.svelte';

export function createAccountController(
  vm: Pick<
    AppRuntime,
    | 'consentRequest'
    | 'consentBusy'
    | 'consentError'
    | 'consent'
    | 'oauthSearch'
    | 'account'
    | 'tab'
    | 'consentDecision'
    | 'appsRequest'
    | 'appsLoading'
    | 'appsError'
    | 'connectedApps'
    | 'revokedApps'
    | 'revoking'
    | 'clearAction'
    | 'noteAction'
    | 'data'
    | 'savedSettings'
    | 'mergePrompt'
    | 'mergeDismissed'
    | 'discardPrompt'
    | 'practice'
    | 'result'
    | 'learned'
    | 'theme'
    | 'message'
    | 'identityVerified'
    | 'deviceCode'
    | 'sync'
    | 'refreshPush'
    | 'save'
    | 'action'
    | 'codeRevealed'
    | 'editEmail'
    | 'emailStatus'
    | 'resendSeconds'
    | 'confirmSignout'
    | 'confirmEverywhere'
    | 'emailOpen'
    | 'confirmDelete'
  >,
) {
  async function loadConsent() {
    const request = ++vm.consentRequest;
    vm.consentBusy = true;
    vm.consentError = '';
    vm.consent = null;
    try {
      const response = await fetch('/api/oauth/consent' + vm.oauthSearch, { cache: 'no-store' });
      if (request !== vm.consentRequest) return;
      if (response.status === 401) {
        vm.account = null;
        vm.tab = ui.account;
        return;
      }
      if (!response.ok) throw Error();
      const out = await response.json();
      if (request === vm.consentRequest) vm.consent = out;
    } catch {
      if (request === vm.consentRequest) vm.consentError = ui.mcpConsentError;
    } finally {
      if (request === vm.consentRequest) vm.consentBusy = false;
    }
  }
  async function decideConsent(decision: 'approve' | 'deny') {
    if (!vm.consent || vm.consentBusy) return;
    vm.consentBusy = true;
    vm.consentError = '';
    vm.consentDecision = decision;
    try {
      const out = await api('/oauth/consent', {
        handle: vm.consent.handle,
        decision,
        statsEnabled: stats.statsEnabled(),
      });
      const target = new URL(out.redirectTo);
      if (!['https:', 'http:'].includes(target.protocol)) throw Error();
      try {
        sessionStorage.removeItem('bh_oauth_return');
      } catch {}
      location.assign(target.href);
    } catch {
      vm.consentError = ui.mcpDecisionError;
      vm.consentBusy = false;
    }
  }
  async function loadConnectedApps() {
    const request = ++vm.appsRequest;
    vm.appsLoading = true;
    vm.appsError = '';
    try {
      const out = await api('/oauth/apps');
      if (request === vm.appsRequest) {
        vm.connectedApps = out.apps || [];
        vm.revokedApps = [];
      }
    } catch {
      if (request === vm.appsRequest) vm.appsError = ui.mcpAppsError;
    } finally {
      if (request === vm.appsRequest) vm.appsLoading = false;
    }
  }
  async function revokeApp(app: ConnectedApp) {
    if (vm.revoking) return;
    vm.revoking = app.id;
    const key = 'revoke-' + app.id;
    vm.clearAction(key);
    try {
      await api('/oauth/revoke', { id: app.id });
      vm.revokedApps = [...vm.revokedApps, app];
      vm.noteAction(key, ui.mcpRevoked(app.clientName));
    } catch {
      vm.noteAction(key, ui.mcpRevokeError, true);
    } finally {
      vm.revoking = '';
    }
  }
  async function refreshIdentity(user: any, revoked = false) {
    const previous = vm.account?.id;
    if (!user && previous && revoked) {
      vm.data = await clearStore();
      vm.savedSettings = structuredClone(defaults);
      vm.mergePrompt = false;
      vm.mergeDismissed = false;
      vm.discardPrompt = false;
      vm.practice = null;
      vm.result = false;
      vm.learned = false;
      vm.theme();
      vm.message = ui.revokedNotice;
    }
    vm.account = user;
    vm.identityVerified = true;
    vm.data.account = user;
    if (
      user &&
      vm.deviceCode?.pending &&
      vm.deviceCode.uid === user.id &&
      vm.deviceCode.revision === user.codeRevision
    ) {
      await persist($state.snapshot(vm.data));
      return;
    }
    if (user && !stats.statsEnabled())
      void api('/oauth/privacy', { enabled: false }).catch(() => {});
    if (user && previous !== user.id && (vm.data.items.length || vm.data.events.length)) {
      await afterSignin();
      return;
    }
    await persist($state.snapshot(vm.data));
    if (user) {
      await vm.sync();
      void vm.refreshPush();
    }
  }
  async function afterSignin(syncNow = true) {
    vm.data.account = vm.account;
    if (vm.data.items.length || vm.data.events.length) {
      vm.mergePrompt = true;
      vm.mergeDismissed = false;
      (vm.data as any).pendingMerge = true;
      await persist($state.snapshot(vm.data));
      return;
    }
    await persist($state.snapshot(vm.data));
    if (syncNow) await vm.sync();
  }
  async function acceptMerge() {
    vm.mergePrompt = false;
    (vm.data as any).pendingMerge = false;
    await vm.sync();
  }
  async function discardLocal() {
    vm.discardPrompt = false;
    vm.mergePrompt = false;
    (vm.data as any).pendingMerge = false;
    vm.data.items = [];
    vm.data.events = [];
    vm.data.queue = [];
    await vm.save();
    await vm.sync();
  }
  async function signout(everywhere = false) {
    await vm.action(everywhere ? 'signout-everywhere' : 'signout', async () => {
      await vm.sync();
      if (vm.data.queue.length) throw Error(ui.signoutNeedsConnection);
      await api(everywhere ? '/auth/logout-everywhere' : '/auth/logout', {});
      vm.account = null;
      forgetDeviceSignInCode();
      vm.deviceCode = null;
      vm.codeRevealed = false;
      vm.editEmail();
      vm.emailStatus = '';
      vm.resendSeconds = 0;
      vm.data = await clearStore();
      vm.savedSettings = structuredClone(defaults);
      vm.confirmSignout = false;
      vm.confirmEverywhere = false;
      vm.noteAction('signed-out', ui.signedOutCleared);
    });
  }
  async function exportData() {
    await vm.action('export', async () => {
      const out = vm.account ? await api(ui.exportPath) : $state.snapshot(vm.data);
      const a = document.createElement(ui.anchorTag);
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: ui.jsonMime }));
      a.download = ui.exportFilename;
      a.click();
      URL.revokeObjectURL(a.href);
      vm.noteAction('export', ui.exportReady);
    });
  }
  async function deleteAccount() {
    await vm.action('delete', async () => {
      await api(ui.accountPath, undefined, ui.deleteMethod);
      vm.account = null;
      forgetDeviceSignInCode();
      vm.deviceCode = null;
      vm.codeRevealed = false;
      vm.editEmail();
      vm.emailOpen = false;
      vm.resendSeconds = 0;
      vm.data.account = null;
      await persist($state.snapshot(vm.data));
      vm.confirmDelete = false;
      vm.noteAction('deleted', ui.accountDeleted);
    });
  }
  return {
    loadConsent,
    decideConsent,
    loadConnectedApps,
    revokeApp,
    refreshIdentity,
    afterSignin,
    acceptMerge,
    discardLocal,
    signout,
    exportData,
    deleteAccount,
  };
}
