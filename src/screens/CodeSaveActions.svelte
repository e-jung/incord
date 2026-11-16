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
      'copyAccountCode' | 'shareAccountCode' | 'printAccountCode' | 'actionNotes'
    >;
  } = $props();
</script>

<div class="code-save-actions">
  <Button secondary onclick={() => void vm.copyAccountCode()}>{ui.codeAccount.copy}</Button><Button
    secondary
    onclick={() => void vm.shareAccountCode()}>{ui.codeAccount.share}</Button
  ><Button secondary onclick={vm.printAccountCode}>{ui.codeAccount.print}</Button>
</div>
<ActionFeedback note={vm.actionNotes['code-copy']} /><ActionFeedback
  note={vm.actionNotes['code-share']}
/>
