import {
  displaySignInCode,
  rememberDeviceSignInCode,
  forgetDeviceSignInCode,
  dismissCodeReminder,
} from '../sign-in-code';

import { incordCopy as incord } from '../config/incord';

import { tick } from 'svelte';
import { copy as ui } from '../config/copy';

import { persist, api } from '../store';
import type { AppRuntime } from './state.svelte';

export function createSigninController(
  vm: Pick<
    AppRuntime,
    | 'codeBusy'
    | 'emailBusy'
    | 'googleLinkError'
    | 'config'
    | 'oauthRoute'
    | 'oauthSearch'
    | 'consentError'
    | 'pendingGroupCode'
    | 'jlBusy'
    | 'jlOptions'
    | 'jlConfirmRequested'
    | 'tab'
    | 'jlEmail'
    | 'jlError'
    | 'account'
    | 'identityVerified'
    | 'afterSignin'
    | 'emailSent'
    | 'emailCode'
    | 'emailError'
    | 'emailStatus'
    | 'resendSeconds'
    | 'emailErrorControl'
    | 'emailAddress'
    | 'emailLink'
    | 'resendUntil'
    | 'emailOpen'
    | 'emailStatusTimer'
    | 'data'
    | 'clearAction'
    | 'codeEntry'
    | 'deviceCode'
    | 'codeRevealed'
    | 'codeConfirm'
    | 'noteAction'
    | 'codeSaved'
    | 'mergePrompt'
    | 'mergeDismissed'
    | 'action'
    | 'codeReminder'
  >,
) {
  function googleSignin(link = false) {
    if (vm.codeBusy || vm.emailBusy) return;
    vm.googleLinkError = '';
    if (vm.config.accountsGoogle) {
      accountsHop(new URLSearchParams({ provider: 'google', ...(link ? { link: '1' } : {}) }));
      return;
    }
    if (vm.oauthRoute) {
      try {
        sessionStorage.setItem('bh_oauth_return', location.pathname + vm.oauthSearch);
      } catch {
        vm.consentError = ui.mcpReturnError;
        return;
      }
    }
    location.href = ui.googleAuthPath + (link ? '?link=1' : '');
  }
  function accountsReturn() {
    return vm.oauthRoute
      ? location.pathname + vm.oauthSearch
      : vm.pendingGroupCode
        ? '/join/' + vm.pendingGroupCode
        : '/?signedIn=1';
  }
  function accountsHop(params: URLSearchParams) {
    params.set('return', accountsReturn());
    location.assign('/api/auth/jesklabs?' + params);
  }
  function primarySignin() {
    if (vm.jlBusy || vm.emailBusy || vm.codeBusy) return;
    let tried = vm.jlOptions;
    try {
      tried = tried || sessionStorage.getItem('bh_jl_options') === '1';
    } catch {}
    if (tried) {
      vm.jlOptions = true;
      void tick().then(() =>
        document.querySelector<HTMLInputElement>('input[type="email"]')?.focus(),
      );
      return;
    }
    accountsHop(new URLSearchParams({ prompt: 'none' }));
  }
  async function loadJlPending() {
    if (!vm.jlConfirmRequested) return;
    vm.tab = ui.account;
    try {
      const out = await api('/auth/jesklabs/pending');
      vm.jlEmail = out.email;
    } catch {
      vm.jlError = ui.jesklabs.retry;
      vm.jlOptions = true;
    }
  }
  async function confirmJl() {
    if (vm.jlBusy) return;
    vm.jlBusy = true;
    vm.jlError = '';
    try {
      const out = await api('/auth/jesklabs/confirm', {});
      vm.jlEmail = '';
      vm.account = out.user;
      vm.identityVerified = true;
      await vm.afterSignin();
      const target = out.returnPath;
      if (
        typeof target === 'string' &&
        target.startsWith('/') &&
        !target.startsWith('//') &&
        new URL(target, location.origin).origin === location.origin
      ) {
        if (new URL(target, location.origin).pathname === location.pathname)
          history.replaceState({ ...history.state, sheet: false }, '', target);
        else location.assign(target);
      }
    } catch (e) {
      vm.jlError = e instanceof Error ? e.message : ui.jesklabs.retry;
    } finally {
      vm.jlBusy = false;
    }
  }
  async function cancelJl() {
    if (vm.jlBusy) return;
    vm.jlBusy = true;
    vm.jlError = '';
    try {
      await api('/auth/jesklabs/cancel', {});
      vm.jlEmail = '';
      vm.jlOptions = true;
      try {
        sessionStorage.setItem('bh_jl_options', '1');
      } catch {}
    } catch {
      vm.jlError = ui.jesklabs.retry;
    } finally {
      vm.jlBusy = false;
    }
  }
  function editEmail() {
    vm.emailSent = false;
    vm.emailCode = '';
    vm.emailError = '';
    vm.emailStatus = '';
  }
  async function sendEmail() {
    if (vm.emailBusy || vm.codeBusy || vm.resendSeconds) return;
    vm.emailBusy = 'send';
    vm.emailErrorControl = 'send';
    vm.emailError = '';
    vm.emailStatus = '';
    const link = !!vm.account;
    try {
      await api('/auth/email/start', { email: vm.emailAddress.trim(), link });
      vm.emailLink = link;
      vm.emailSent = true;
      vm.emailCode = '';
      vm.emailStatus = ui.emailSent;
      vm.resendUntil = Date.now() + 30000;
      vm.resendSeconds = 30;
    } catch (e) {
      vm.emailError = e instanceof Error ? e.message : String(e);
    } finally {
      vm.emailBusy = '';
    }
  }
  async function verifyEmail() {
    if (vm.emailBusy || vm.codeBusy || !/^\d{6}$/.test(vm.emailCode)) return;
    vm.emailBusy = 'verify';
    vm.emailErrorControl = 'verify';
    vm.emailError = '';
    try {
      const wasSignedIn = !!vm.account,
        returnPath = accountsReturn();
      const out = await api('/auth/email/verify', {
        email: vm.emailAddress.trim(),
        code: vm.emailCode,
        link: vm.emailLink,
      });
      vm.account = out.user || out.account;
      vm.identityVerified = true;
      vm.emailSent = false;
      vm.emailCode = '';
      vm.emailOpen = false;
      vm.emailStatus = wasSignedIn ? ui.emailLinked : '';
      clearTimeout(vm.emailStatusTimer);
      vm.emailStatusTimer = setTimeout(() => (vm.emailStatus = ''), 3000);
      if (wasSignedIn) {
        vm.data.account = vm.account;
        await persist($state.snapshot(vm.data));
      } else {
        await vm.afterSignin(!out.ssoTicket);
      }
      if (out.ssoTicket) {
        const attach = new URL('https://accounts.jesklabs.com/sso/attach');
        attach.search = new URLSearchParams({
          ticket: out.ssoTicket,
          client: 'incord',
          return: wasSignedIn ? '/?googleLink=linked' : returnPath,
        }).toString();
        location.assign(attach.href);
      }
    } catch (e) {
      vm.emailError = e instanceof Error ? e.message : String(e);
    } finally {
      vm.emailBusy = '';
    }
  }
  function codeInput(event: Event) {
    vm.emailCode = (event.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
    if (vm.emailCode.length === 6) void verifyEmail();
  }
  async function codeAccountAction(kind: 'create' | 'signin' | 'regenerate' | 'remove') {
    if (vm.codeBusy || vm.emailBusy) return;
    vm.codeBusy = kind;
    vm.clearAction('code-' + kind);
    try {
      const out = await api('/auth/code/' + kind, kind === 'signin' ? { code: vm.codeEntry } : {});
      if (kind === 'remove') {
        vm.account = out.user;
        vm.data.account = vm.account;
        forgetDeviceSignInCode();
        vm.deviceCode = null;
        vm.codeRevealed = false;
        vm.codeConfirm = '';
        await persist($state.snapshot(vm.data));
        vm.noteAction('code-remove', ui.codeAccount.removed);
        return;
      }
      const user = out.user;
      if (kind === 'create' || kind === 'regenerate') {
        vm.deviceCode = {
          uid: user.id,
          code: out.code,
          revision: user.codeRevision,
          pending: true,
          newAccount: kind === 'create',
        };
        rememberDeviceSignInCode($state.snapshot(vm.deviceCode));
        vm.codeSaved = false;
        vm.codeRevealed = false;
        vm.codeConfirm = '';
        vm.account = user;
        vm.identityVerified = true;
        vm.data.account = user;
        if (kind === 'create' && (vm.data.items.length || vm.data.events.length)) {
          vm.mergePrompt = true;
          vm.mergeDismissed = false;
          (vm.data as any).pendingMerge = true;
        }
        await persist($state.snapshot(vm.data));
      } else {
        vm.deviceCode = {
          uid: user.id,
          code: displaySignInCode(vm.codeEntry),
          revision: user.codeRevision,
          pending: false,
        };
        rememberDeviceSignInCode($state.snapshot(vm.deviceCode));
        vm.codeEntry = '';
        vm.account = user;
        vm.identityVerified = true;
        await vm.afterSignin();
      }
    } catch (e) {
      vm.noteAction('code-' + kind, e instanceof Error ? e.message : String(e), true);
    } finally {
      vm.codeBusy = '';
    }
  }
  async function finishSavingCode() {
    if (!vm.codeSaved || !vm.deviceCode) return;
    const isNew = vm.deviceCode.newAccount;
    vm.deviceCode = { ...vm.deviceCode, pending: false, newAccount: false };
    rememberDeviceSignInCode($state.snapshot(vm.deviceCode));
    vm.codeSaved = false;
    if (isNew) await vm.afterSignin();
    else await persist($state.snapshot(vm.data));
  }
  async function copyAccountCode() {
    if (!vm.deviceCode) return;
    await vm.action(
      'code-copy',
      async () => {
        try {
          await navigator.clipboard.writeText(vm.deviceCode!.code);
        } catch {
          throw Error(ui.codeAccount.copyError);
        }
      },
      ui.codeAccount.copied,
    );
  }
  async function shareAccountCode() {
    if (!vm.deviceCode) return;
    if (!navigator.share) {
      await copyAccountCode();
      return;
    }
    await vm.action('code-share', async () => {
      try {
        await navigator.share({ title: ui.codeAccount.printTitle, text: vm.deviceCode!.code });
        vm.noteAction('code-share', ui.codeAccount.shared);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) throw e;
      }
    });
  }
  function printAccountCode() {
    const root = document.documentElement;
    root.classList.add('code-card-print');
    const finish = () => root.classList.remove('code-card-print');
    window.addEventListener('afterprint', finish, { once: true });
    try {
      window.print();
    } catch {
      finish();
      window.removeEventListener('afterprint', finish);
    }
  }
  function forgetCodeBackupReminder() {
    if (vm.account) vm.codeReminder = dismissCodeReminder(vm.account.id);
  }
  return {
    googleSignin,
    accountsReturn,
    accountsHop,
    primarySignin,
    loadJlPending,
    confirmJl,
    cancelJl,
    editEmail,
    sendEmail,
    verifyEmail,
    codeInput,
    codeAccountAction,
    finishSavingCode,
    copyAccountCode,
    shareAccountCode,
    printAccountCode,
    forgetCodeBackupReminder,
  };
}
