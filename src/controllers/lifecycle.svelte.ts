import { forgetDeviceSignInCode, codeReminderUntil } from '../sign-in-code';

import * as stats from '../stats';

import { tick, untrack } from 'svelte';
import { copy as ui } from '../config/copy';

import { onMount } from 'svelte';

import { openStore, api, installReconnectSync, defaults, today } from '../store';
import type { AppRuntime } from './state.svelte';

export function installAppLifecycle(vm: AppRuntime) {
  $effect(() => {
    const id = vm.attentionAccount,
      active = vm.tab;
    untrack(() => {
      if (id !== vm.attentionIdentity) {
        vm.attentionIdentity = id;
        vm.attentionRequest++;
        vm.attentionUpdated = 0;
        vm.groupAttention = null;
        vm.attentionDirty = false;
        if (id && active !== ui.groups.heading) void vm.refreshGroupAttention(true);
      } else if (id && active === ui.today) void vm.refreshGroupAttention();
    });
  });
  $effect(() => {
    const key = vm.account?.id + ':' + vm.pendingGroupCode;
    if (
      vm.ready &&
      vm.identityVerified &&
      vm.account &&
      !vm.awaitingCodeSave &&
      !vm.oauthRoute &&
      !vm.mergePrompt &&
      ((vm.pendingGroupCode && vm.resumedGroupInvite !== key) || vm.returnToGroups)
    ) {
      vm.resumedGroupInvite = key;
      vm.returnToGroups = false;
      try {
        sessionStorage.removeItem('bh_groups_return');
      } catch {}
      vm.tab = ui.groups.heading;
      vm.detail = '';
      vm.practice = null;
      window.scrollTo(0, 0);
    }
  });
  $effect(() => {
    const user = vm.account?.id;
    if (vm.ready && vm.identityVerified && !vm.awaitingCodeSave && vm.oauthRoute) {
      void user;
      void tick().then(vm.loadConsent);
    }
  });
  $effect(() => {
    const user = vm.account?.id;
    if (vm.ready && vm.identityVerified && vm.tab === ui.account && user) {
      void tick().then(vm.loadConnectedApps);
    } else if (!user) {
      vm.appsRequest++;
      vm.connectedApps = [];
      vm.appsError = '';
      vm.revokedApps = [];
    }
  });
  $effect(() => {
    if (vm.tab !== ui.account) vm.codeRevealed = false;
  });
  $effect(() => {
    const user = vm.account;
    if (vm.identityVerified) {
      if (user) {
        vm.codeReminder = codeReminderUntil(user.id);
        if (
          vm.deviceCode &&
          (vm.deviceCode.uid !== user.id ||
            !user.hasCode ||
            vm.deviceCode.revision !== user.codeRevision)
        ) {
          forgetDeviceSignInCode();
          vm.deviceCode = null;
          vm.codeRevealed = false;
        }
      } else if (vm.ready) {
        forgetDeviceSignInCode();
        vm.deviceCode = null;
        vm.codeRevealed = false;
      }
    }
  });
  $effect(() => {
    if (!vm.resendSeconds) return;
    const timer = setInterval(
      () => (vm.resendSeconds = Math.max(0, Math.ceil((vm.resendUntil - Date.now()) / 1000))),
      250,
    );
    return () => clearInterval(timer);
  });
  $effect(() => {
    const current = vm.screen;
    if (vm.previousScreen !== current) {
      vm.clearToasts();
      vm.previousScreen = current;
    }
  });
  $effect(() => {
    vm.feedback.setSettings({
      keySounds: vm.data.settings.keySounds,
      haptics: vm.data.settings.haptics,
    });
  });
  $effect(() => {
    const value = vm.data.settings.defaultTranslation;
    if (vm.previousTranslation !== undefined && vm.previousTranslation !== value)
      vm.resetTranslationResults();
    vm.previousTranslation = value;
  });
  $effect(() => {
    vm.data.queue.length;
    vm.account;
    vm.mergePrompt;
    vm.awaitingCodeSave;
    vm.queueRetry.update();
  });
  onMount(() => {
    const stopStats = stats.installStats();
    history.replaceState({ byheart: true, rootGuard: true, tab: vm.tab, detail: '' }, '');
    history.pushState({ byheart: true, tab: vm.tab, detail: '' }, '');
    const back = (event: PopStateEvent) => {
      if (vm.suppressPop) {
        vm.suppressPop = false;
        return;
      }
      vm.passageRequest++;
      vm.loadingPassage = false;
      if (vm.awaitingCodeSave) {
      } else if (vm.jlEmail) {
        if (!vm.jlBusy) void vm.cancelJl();
      } else if (vm.codeConfirm) {
        if (!vm.codeBusy) vm.codeConfirm = '';
      } else if (vm.groupDialogClose) {
        vm.groupDialogClose();
      } else if (vm.confirmEverywhere) {
        vm.confirmEverywhere = false;
      } else if (vm.discardPrompt) {
        vm.discardPrompt = false;
      } else if (vm.mergePrompt && !vm.mergeDismissed) {
        vm.mergeDismissed = true;
      } else if (vm.confirmLeavePractice) {
        vm.confirmLeavePractice = false;
      } else if (vm.result) {
        vm.continueResult();
      } else if (vm.welcome) {
        vm.welcome = false;
      } else if (vm.confirmSignout) {
        vm.confirmSignout = false;
      } else if (vm.preview) {
        vm.preview = null;
      } else if (vm.removeTarget) {
        vm.removeTarget = null;
      } else if (vm.confirmBatch) {
        vm.confirmBatch = null;
      } else if (vm.confirmDelete) {
        vm.confirmDelete = false;
      } else if (vm.practice) {
        vm.requestClosePractice();
      } else {
        const to = event.state?.tab || ui.today;
        vm.abandonGroupSignin(to);
        vm.tab = to;
        vm.detail = event.state?.detail || '';
      }
      window.scrollTo(0, 0);
      if (!event.state?.byheart || event.state?.rootGuard)
        history.pushState({ byheart: true, tab: vm.tab, detail: vm.detail }, '');
    };
    window.addEventListener('popstate', back);
    void vm.attempt(async () => {
      vm.data = await openStore();
      vm.data.settings = { ...defaults, newPerDay: 3, ...vm.data.settings };
      vm.savedSettings = structuredClone($state.snapshot(vm.data.settings));
      vm.account = vm.data.account || null;
      vm.mergePrompt = !!(vm.data as any).pendingMerge;
      vm.ready = true;
      vm.theme();
      vm.shareCounts = stats.statsEnabled();
      vm.privacySignal = stats.browserPrivacyOff();
      vm.welcome =
        !vm.oauthRoute && vm.daysAway >= 7 && vm.rampDay >= 7 && vm.live.some((i) => i.learned);
      if (vm.welcome) stats.trackStats('welcome_back_shown');
      void api('/config')
        .then((out) => (vm.config = out))
        .catch(() => {});
      try {
        const out = await api('/me');
        await vm.refreshIdentity(out.user || out.account || null, out.signedOutEverywhere);
      } catch {
        vm.online = false;
      }
      await vm.loadJlPending();
    });
    const attentionFocus = () => {
      if (document.visibilityState === 'visible' && vm.tab !== ui.groups.heading)
        void vm.refreshGroupAttention();
    };
    window.addEventListener('focus', attentionFocus);
    document.addEventListener('visibilitychange', attentionFocus);
    const pushCheck = () => {
      if (vm.account) void vm.refreshPush();
    };
    navigator.serviceWorker?.addEventListener('controllerchange', pushCheck);
    window.addEventListener('focus', pushCheck);
    const connection = () => (vm.online = navigator.onLine);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    const retry = installReconnectSync(async () => {
      try {
        const out = await api('/me');
        await vm.refreshIdentity(out.user || null, out.signedOutEverywhere);
      } catch {}
    });
    return () => {
      vm.attentionRequest++;
      window.removeEventListener('focus', attentionFocus);
      document.removeEventListener('visibilitychange', attentionFocus);
      for (const timer of vm.actionTimers.values()) clearTimeout(timer);
      clearTimeout(vm.feedbackTimer);
      clearTimeout(vm.emailStatusTimer);
      clearTimeout(vm.batchTimer);
      vm.feedback.destroy();
      stopStats();
      navigator.serviceWorker?.removeEventListener('controllerchange', pushCheck);
      window.removeEventListener('focus', pushCheck);
      retry();
      vm.queueRetry.stop();
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      window.removeEventListener('popstate', back);
      vm.clearToasts();
      vm.clearTapFeedback();
    };
  });
  $effect(() => {
    const opened = !!(
      vm.jlEmail ||
      vm.awaitingCodeSave ||
      vm.codeConfirm ||
      vm.confirmLeavePractice ||
      vm.groupDialogClose ||
      vm.confirmEverywhere ||
      vm.preview ||
      vm.removeTarget ||
      vm.confirmBatch ||
      vm.confirmDelete ||
      vm.welcome ||
      vm.confirmSignout ||
      (vm.mergePrompt && !vm.mergeDismissed) ||
      vm.discardPrompt ||
      vm.result
    );
    if (opened && !vm.modalOpen) {
      vm.clearToasts();
      history.pushState({ byheart: true, tab: vm.tab, detail: vm.detail, sheet: true }, '');
    } else if (!opened && vm.modalOpen && history.state?.sheet) {
      vm.suppressPop = true;
      history.back();
    }
    vm.modalOpen = opened;
  });
  $effect(() => {
    if (vm.ready && vm.tab === ui.account) {
      vm.account?.id;
      void vm.refreshPush();
    }
  });
  $effect(() => {
    const id = vm.practice?.id,
      step = vm.attemptStep,
      isLearned = vm.learned,
      showingResult = vm.result;
    if (id && !isLearned && !showingResult) {
      void tick().then(() => {
        window.scrollTo(0, 0);
        vm.practiceRegion?.focus({ preventScroll: true });
      });
    }
  });
}
