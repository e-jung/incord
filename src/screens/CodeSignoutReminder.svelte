<script lang="ts">
  import ActionFeedback from '../components/ActionFeedback.svelte';

  import { copy as ui } from '../config/copy';

  import Button from '../components/Button.svelte';

  import type { AppRuntime } from '../controllers/state.svelte';

  let {
    vm,
  }: {
    vm: Pick<
      AppRuntime,
      'account' | 'deviceCode' | 'codeRevealed' | 'copyAccountCode' | 'actionNotes'
    >;
  } = $props();
</script>

{#if vm.account?.hasCode && !vm.account?.hasEmail && !vm.account?.hasGoogle}<p>
    {ui.codeAccount.signoutWarning}
  </p>
  {#if vm.deviceCode}<Button
      secondary
      ariaExpanded={vm.codeRevealed}
      ariaControls="signout-signin-code"
      onclick={() => (vm.codeRevealed = !vm.codeRevealed)}
      >{vm.codeRevealed ? ui.codeAccount.hide : ui.codeAccount.reveal}</Button
    >{#if vm.codeRevealed}<p id="signout-signin-code" class="signin-code-value" data-private>
        {vm.deviceCode.code}
      </p>
      <Button secondary onclick={() => void vm.copyAccountCode()}>{ui.codeAccount.copy}</Button
      ><ActionFeedback note={vm.actionNotes['code-copy']} />{/if}{/if}{/if}
