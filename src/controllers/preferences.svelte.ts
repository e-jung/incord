import * as stats from '../stats';
import { appVersion } from '../telemetry';
import { pushHealth, type Delivery } from '../notifications';
import { tick } from 'svelte';
import { copy as ui } from '../config/copy';

import { api } from '../store';
import type { AppRuntime } from './state.svelte';

export function createPreferencesController(
  vm: Pick<
    AppRuntime,
    | 'account'
    | 'feedbackResult'
    | 'feedbackBusy'
    | 'feedbackError'
    | 'feedbackStatus'
    | 'feedbackMessage'
    | 'feedbackContact'
    | 'feedbackKind'
    | 'feedbackIncludeMeta'
    | 'feedbackTimer'
    | 'shareCounts'
    | 'action'
    | 'pushState'
    | 'deliveries'
    | 'noteAction'
    | 'config'
    | 'data'
    | 'save'
  >,
) {
  function feedbackMeta() {
    const ua = navigator.userAgent;
    const platform =
      /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
        ? 'iOS'
        : /Android/i.test(ua)
          ? 'Android'
          : /Macintosh|Mac OS X/i.test(ua)
            ? 'macOS'
            : /Windows/i.test(ua)
              ? 'Windows'
              : /Linux/i.test(ua)
                ? 'Linux'
                : 'Other';
    const uaFamily = /Edg(?:e|A|iOS)?\//i.test(ua)
      ? 'Edge'
      : /Firefox|FxiOS/i.test(ua)
        ? 'Firefox'
        : /Chromium/i.test(ua)
          ? 'Chromium'
          : /Chrome|CriOS/i.test(ua)
            ? 'Chrome'
            : /Safari/i.test(ua)
              ? 'Safari'
              : 'Other';
    return {
      version: appVersion,
      platform,
      uaFamily,
      viewport: {
        width: Math.min(16384, Math.max(1, window.innerWidth)),
        height: Math.min(16384, Math.max(1, window.innerHeight)),
      },
      signedIn: !!vm.account,
    };
  }
  async function showFeedbackResult() {
    await tick();
    const result = vm.feedbackResult;
    if (!result) return;
    result.focus({ preventScroll: true });
    const rect = result.getBoundingClientRect(),
      viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0,
      bottom = top + (viewport?.height || window.innerHeight);
    const bar = document.querySelector('.tabbar')?.getBoundingClientRect();
    const visibleBottom = bar && bar.top > top ? Math.min(bottom, bar.top - 12) : bottom - 12;
    if (rect.top < top + 12 || rect.bottom > visibleBottom)
      window.scrollBy({
        top: rect.bottom > visibleBottom ? rect.bottom - visibleBottom : rect.top - top - 12,
        behavior: 'instant',
      });
  }
  async function sendFeedback() {
    if (vm.feedbackBusy) return;
    vm.feedbackError = '';
    vm.feedbackStatus = '';
    const message = vm.feedbackMessage.trim(),
      contact = vm.feedbackContact.trim();
    if (message.length < 10 || message.length > 4000) {
      vm.feedbackError = ui.feedbackLengthError;
      await showFeedbackResult();
      return;
    }
    if (
      contact &&
      (!/^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(contact) ||
        /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(contact))
    ) {
      vm.feedbackError = ui.feedbackContactError;
      await showFeedbackResult();
      return;
    }
    vm.feedbackBusy = true;
    try {
      const out = await api('/feedback', {
        kind: vm.feedbackKind,
        message,
        ...(contact ? { contact } : {}),
        ...(vm.feedbackIncludeMeta ? { meta: feedbackMeta() } : {}),
      });
      vm.feedbackStatus = out.message || ui.feedbackThanks;
      clearTimeout(vm.feedbackTimer);
      vm.feedbackTimer = setTimeout(() => (vm.feedbackStatus = ''), 3000);
      vm.feedbackMessage = '';
      vm.feedbackContact = '';
    } catch (e) {
      vm.feedbackError =
        e instanceof TypeError || e instanceof SyntaxError
          ? ui.feedbackSendError
          : e instanceof Error
            ? e.message
            : ui.feedbackSendError;
    } finally {
      vm.feedbackBusy = false;
      await showFeedbackResult();
    }
  }
  async function setShareCounts(event: Event) {
    stats.setStatsEnabled((event.currentTarget as HTMLInputElement).checked);
    vm.shareCounts = stats.statsEnabled();
    await vm.action(
      'privacy',
      async () => {
        if (vm.account) await api('/oauth/privacy', { enabled: vm.shareCounts });
      },
      ui.preferenceSaved,
    );
  }
  async function refreshPush() {
    try {
      const health = await pushHealth(!!vm.account);
      vm.pushState = health.state;
      vm.deliveries = health.results;
    } catch {
      vm.pushState = 'unavailable';
    }
  }
  async function testPush() {
    await vm.action('test-push', async () => {
      let out: any;
      try {
        out = await api(ui.testPushPath, {});
      } catch (e) {
        stats.trackStats('push_test:failed');
        throw e;
      }
      vm.noteAction(
        'test-push',
        out.results?.length
          ? out.results.map((r: Delivery) => ui.pushOutcome(r.host, r.status, r.reason)).join(' ')
          : ui.noPushDevices,
        !out.results?.length ||
          out.results.some((r: Delivery) => r.status < 200 || r.status >= 300),
      );
      await refreshPush();
      stats.trackStats(
        out.results?.some((r: Delivery) => r.status >= 200 && r.status < 300)
          ? 'push_test:sent'
          : 'push_test:failed',
      );
    });
  }
  async function enablePush() {
    await vm.action('reminders', async () => {
      if (!vm.account) throw Error(ui.signInForReminders);
      if (!(ui.notificationApi in window) || !(ui.pushManagerApi in window))
        throw Error(ui.iosInstallNotice);
      const permission = await Notification.requestPermission();
      if (permission !== ui.permissionGranted) throw Error(ui.notificationDenied);
      const reg = await navigator.serviceWorker.ready;
      const raw = vm.config.vapidPublicKey || vm.config.vapid;
      if (!raw) throw Error(ui.vapidUnavailable);
      const key = Uint8Array.from(
        atob(raw.replace(/-/g, ui.base64Plus).replace(/_/g, ui.base64Slash)),
        (c) => c.charCodeAt(0),
      );
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await api(ui.pushSubscribePath, { subscription: sub.toJSON() });
      vm.data.settings.pushEnabled = true;
      await vm.save();
      await refreshPush();
      stats.trackStats('reminders_enabled');
      vm.noteAction('reminders', ui.remindersEnabled);
    });
  }
  async function disablePush() {
    await vm.action('reminders', async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await api(ui.pushSubscribePath, { subscription: null, endpoint: sub.endpoint });
      }
      vm.data.settings.pushEnabled = false;
      await vm.save();
      await refreshPush();
      vm.noteAction('reminders', ui.reminderOff);
    });
  }
  return {
    feedbackMeta,
    showFeedbackResult,
    sendFeedback,
    setShareCounts,
    refreshPush,
    testPush,
    enablePush,
    disablePush,
  };
}
