<script lang="ts">
  import CodeSaveActions from './CodeSaveActions.svelte';
  import ActionFeedback from '../components/ActionFeedback.svelte';

  import { copy as ui } from '../config/copy';

  import Button from '../components/Button.svelte';

  import type { AppRuntime } from '../controllers/state.svelte';

  let {
    vm,
  }: {
    vm: Pick<
      AppRuntime,
      | 'account'
      | 'deviceCode'
      | 'codeRevealed'
      | 'codeBusy'
      | 'emailBusy'
      | 'clearAction'
      | 'codeConfirm'
      | 'codeAccountAction'
      | 'actionNotes'
      | 'codeReminder'
      | 'forgetCodeBackupReminder'
      | 'codeEntry'
      | 'copyAccountCode'
      | 'shareAccountCode'
      | 'printAccountCode'
    >;
  } = $props();
</script>

{#if vm.account}
  <section class="signin-code-settings stack" aria-label={ui.codeAccount.title}>
    <h4>{ui.codeAccount.title}</h4>
    {#if vm.account.hasCode}
      {#if vm.deviceCode && vm.deviceCode.uid === vm.account.id && vm.deviceCode.revision === vm.account.codeRevision}
        <Button
          secondary
          ariaExpanded={vm.codeRevealed}
          ariaControls="saved-signin-code"
          onclick={() => (vm.codeRevealed = !vm.codeRevealed)}
          >{vm.codeRevealed ? ui.codeAccount.hide : ui.codeAccount.reveal}</Button
        >
        {#if vm.codeRevealed}<p id="saved-signin-code" class="signin-code-value" data-private>
            {vm.deviceCode.code}
          </p>
          <CodeSaveActions {vm} />{/if}
      {:else}<p>{ui.codeAccount.missing}</p>{/if}
      <small>{ui.codeAccount.deviceOnly}</small>
      <Button
        secondary
        disabled={!!vm.codeBusy || !!vm.emailBusy}
        onclick={() => {
          vm.clearAction('code-regenerate');
          vm.codeConfirm = 'regenerate';
        }}>{ui.codeAccount.regenerate}</Button
      >
      {#if vm.account.hasEmail || vm.account.hasGoogle}<Button
          secondary
          disabled={!!vm.codeBusy || !!vm.emailBusy}
          onclick={() => {
            vm.clearAction('code-remove');
            vm.codeConfirm = 'remove';
          }}>{ui.codeAccount.remove}</Button
        >{/if}
    {:else}<Button
        secondary
        disabled={!!vm.codeBusy || !!vm.emailBusy}
        onclick={() => void vm.codeAccountAction('regenerate')}>{ui.codeAccount.add}</Button
      ><ActionFeedback note={vm.actionNotes['code-regenerate']} />{/if}
    <ActionFeedback note={vm.actionNotes['code-remove']} />
    {#if vm.account.hasCode && !vm.account.hasEmail && !vm.account.hasGoogle && vm.codeReminder <= Date.now()}<div
        class="code-backup-hint stack"
      >
        <p>{ui.codeAccount.backup}</p>
        <button class="text-button" onclick={vm.forgetCodeBackupReminder}
          >{ui.codeAccount.dismiss}</button
        >
      </div>{/if}
  </section>
{:else}
  <div class="signin-code-entry stack">
    <Button
      secondary
      disabled={!!vm.codeBusy || !!vm.emailBusy}
      onclick={() => void vm.codeAccountAction('create')}
      >{vm.codeBusy === 'create' ? ui.codeAccount.creating : ui.codeAccount.create}</Button
    ><ActionFeedback note={vm.actionNotes['code-create']} />
    <form
      class="stack"
      aria-label={ui.codeAccount.signin}
      onsubmit={(event) => {
        event.preventDefault();
        void vm.codeAccountAction('signin');
      }}
    >
      <label
        >{ui.codeAccount.field}<input
          type="text"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          maxlength={90}
          bind:value={vm.codeEntry}
          placeholder={ui.codeAccount.placeholder}
          disabled={!!vm.codeBusy || !!vm.emailBusy}
        /></label
      >
      <Button
        secondary
        type="submit"
        disabled={!!vm.codeBusy || !!vm.emailBusy || !vm.codeEntry.trim()}
        >{vm.codeBusy === 'signin' ? ui.codeAccount.signingIn : ui.codeAccount.signin}</Button
      ><ActionFeedback note={vm.actionNotes['code-signin']} />
    </form>
  </div>
{/if}
