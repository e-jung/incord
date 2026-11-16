<script lang="ts">
  import { copy as ui } from '../config/copy';

  import Button from '../components/Button.svelte';

  import type { AppRuntime } from '../controllers/state.svelte';

  let {
    vm,
  }: {
    vm: Pick<
      AppRuntime,
      | 'emailError'
      | 'emailErrorControl'
      | 'emailSent'
      | 'verifyEmail'
      | 'sendEmail'
      | 'account'
      | 'emailAddress'
      | 'emailBusy'
      | 'codeBusy'
      | 'emailStatus'
      | 'emailCode'
      | 'codeInput'
      | 'resendSeconds'
      | 'editEmail'
    >;
  } = $props();
</script>

{#snippet emailFeedback(control: string)}
  {#if vm.emailError && vm.emailErrorControl === control}<p role="alert">{vm.emailError}</p>{/if}
{/snippet}
<form
  class="stack"
  onsubmit={(event) => {
    event.preventDefault();
    void (vm.emailSent ? vm.verifyEmail() : vm.sendEmail());
  }}
  aria-label={vm.account ? ui.addEmail : ui.emailSignin}
>
  <label
    >{ui.emailAddress}<input
      type="email"
      autocomplete="email"
      required
      maxlength={254}
      bind:value={vm.emailAddress}
      disabled={vm.emailSent || !!vm.emailBusy || !!vm.codeBusy}
    /></label
  >
  {#if vm.emailStatus}<p role="status">{vm.emailStatus}</p>{/if}
  {#if vm.emailSent}
    <label
      >{ui.emailCode}<input
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]{6}"
        maxlength={6}
        value={vm.emailCode}
        oninput={vm.codeInput}
        disabled={!!vm.codeBusy || !!vm.emailBusy}
      /></label
    >
    <Button type="submit" disabled={!!vm.codeBusy || !!vm.emailBusy || vm.emailCode.length !== 6}
      >{vm.emailBusy === 'verify' ? ui.verifyingCode : ui.verifyCode}</Button
    >
    {@render emailFeedback('verify')}
    <Button
      secondary
      onclick={() => void vm.sendEmail()}
      disabled={!!vm.codeBusy || !!vm.emailBusy || vm.resendSeconds > 0}
      >{vm.emailBusy === 'send'
        ? ui.sendingCode
        : vm.resendSeconds
          ? ui.resendCountdown(vm.resendSeconds)
          : ui.resendCode}</Button
    >
    {@render emailFeedback('send')}
    <Button secondary onclick={vm.editEmail} disabled={!!vm.codeBusy || !!vm.emailBusy}
      >{ui.changeEmail}</Button
    >
  {:else}
    <Button type="submit" disabled={!!vm.codeBusy || !!vm.emailBusy || vm.resendSeconds > 0}
      >{vm.emailBusy === 'send'
        ? ui.sendingCode
        : vm.resendSeconds
          ? ui.resendCountdown(vm.resendSeconds)
          : ui.sendCode}</Button
    >
    {@render emailFeedback('send')}
  {/if}
</form>
