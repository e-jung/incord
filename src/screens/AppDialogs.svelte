<script lang="ts">
  import ActionFeedback from '../components/ActionFeedback.svelte';

  import { copy as ui } from '../config/copy';

  import Button from '../components/Button.svelte';
  import List from '../components/List.svelte';
  import Row from '../components/Row.svelte';

  import Sheet from '../components/Sheet.svelte';

  import { addItems, today } from '../store';

  import type { AppRuntime } from '../controllers/state.svelte';
  import CodeSaveActions from './CodeSaveActions.svelte';
  import CodeSignoutReminder from './CodeSignoutReminder.svelte';
  let {
    vm,
  }: {
    vm: Pick<
      AppRuntime,
      | 'confirmLeavePractice'
      | 'closePractice'
      | 'jlEmail'
      | 'jlBusy'
      | 'confirmJl'
      | 'cancelJl'
      | 'jlError'
      | 'awaitingCodeSave'
      | 'deviceCode'
      | 'codeSaved'
      | 'codeBusy'
      | 'finishSavingCode'
      | 'codeConfirm'
      | 'codeAccountAction'
      | 'actionNotes'
      | 'confirmDelete'
      | 'busy'
      | 'deleteAccount'
      | 'welcome'
      | 'live'
      | 'data'
      | 'save'
      | 'begin'
      | 'preview'
      | 'addStarter'
      | 'goalTarget'
      | 'groupGoalBusy'
      | 'setGroupGoal'
      | 'groupGoalError'
      | 'removeTarget'
      | 'remove'
      | 'undoItem'
      | 'practice'
      | 'undo'
      | 'confirmBatch'
      | 'batchAdded'
      | 'confirmBatchAdd'
      | 'confirmSignout'
      | 'signout'
      | 'oauthRoute'
      | 'mergePrompt'
      | 'mergeDismissed'
      | 'discardPrompt'
      | 'acceptMerge'
      | 'discardLocal'
      | 'confirmEverywhere'
      | 'account'
      | 'copyAccountCode'
      | 'shareAccountCode'
      | 'printAccountCode'
      | 'codeRevealed'
    >;
  } = $props();
</script>

{#if vm.confirmLeavePractice}<Sheet
    title={ui.leavePracticeTitle}
    close={() => (vm.confirmLeavePractice = false)}
    ><p>{ui.leavePracticeDetail}</p>
    <Button onclick={vm.closePractice}>{ui.leavePractice}</Button><Button
      secondary
      onclick={() => (vm.confirmLeavePractice = false)}>{ui.keepPracticing}</Button
    ></Sheet
  >{/if}
{#if vm.jlEmail}<Sheet title={ui.jesklabs.confirmTitle}
    ><p data-private>{ui.jesklabs.continueAs(vm.jlEmail)}</p>
    <Button disabled={vm.jlBusy} onclick={() => void vm.confirmJl()}>{ui.jesklabs.continue}</Button
    ><Button secondary disabled={vm.jlBusy} onclick={() => void vm.cancelJl()}
      >{ui.jesklabs.different}</Button
    >{#if vm.jlError}<p role="alert">{vm.jlError}</p>{/if}</Sheet
  >{/if}
{#if vm.awaitingCodeSave}<Sheet title={ui.codeAccount.saveTitle}
    ><p>{ui.codeAccount.saveDetail}</p>
    <p class="signin-code-value" data-private>{vm.deviceCode!.code}</p>
    <CodeSaveActions {vm} /><label class="code-save-check"
      ><input type="checkbox" bind:checked={vm.codeSaved} />{ui.codeAccount.saved}</label
    ><Button disabled={!vm.codeSaved || !!vm.codeBusy} onclick={() => void vm.finishSavingCode()}
      >{ui.codeAccount.continue}</Button
    ></Sheet
  >{/if}
{#if vm.codeConfirm}<Sheet
    title={vm.codeConfirm === 'regenerate'
      ? ui.codeAccount.regenerateTitle
      : ui.codeAccount.removeTitle}
    close={() => {
      if (!vm.codeBusy) vm.codeConfirm = '';
    }}
    ><p>
      {vm.codeConfirm === 'regenerate'
        ? ui.codeAccount.regenerateDetail
        : ui.codeAccount.removeDetail}
    </p>
    <Button
      disabled={!!vm.codeBusy}
      onclick={() => void vm.codeAccountAction(vm.codeConfirm as 'regenerate' | 'remove')}
      >{vm.codeBusy
        ? ui.codeAccount.busy
        : vm.codeConfirm === 'regenerate'
          ? ui.codeAccount.replace
          : ui.codeAccount.remove}</Button
    ><ActionFeedback note={vm.actionNotes['code-' + vm.codeConfirm]} /><Button
      secondary
      disabled={!!vm.codeBusy}
      onclick={() => (vm.codeConfirm = '')}>{ui.codeAccount.cancel}</Button
    ></Sheet
  >{/if}
{#if vm.confirmDelete}<Sheet title={ui.deleteTitle} close={() => (vm.confirmDelete = false)}
    ><p>{ui.deleteInstructions}</p>
    <Button disabled={vm.busy} onclick={() => void vm.deleteAccount()}>{ui.confirmDelete}</Button
    ><ActionFeedback note={vm.actionNotes.delete} /><Button
      secondary
      onclick={() => (vm.confirmDelete = false)}>{ui.keepAccount}</Button
    ></Sheet
  >{/if}
{#if vm.welcome && !vm.awaitingCodeSave}<Sheet
    title={ui.welcomeBack}
    close={() => (vm.welcome = false)}
    ><p>{ui.welcomeCount(Math.min(3, vm.live.filter((i) => i.learned).length))}</p>
    <Button
      onclick={() => {
        vm.data.settings.returnStart = today();
        vm.welcome = false;
        void vm.save();
      }}>{ui.start}</Button
    ><Button
      secondary
      onclick={() => {
        vm.data.settings.returnStart = today();
        vm.welcome = false;
        void vm.save();
        vm.begin(vm.live.filter((i) => i.learned).slice(0, 3));
      }}>{ui.checkMemory}</Button
    ></Sheet
  >{/if}
{#if vm.preview}<Sheet title={vm.preview.title} close={() => (vm.preview = null)}
    ><List
      >{#each vm.preview.items as item}<Row
          title={item.title}
          subtitle={item.text}
          translation={item.translation}
        />{/each}</List
    ><Button onclick={() => void vm.addStarter(vm.preview)}>{ui.addToMyLibrary}</Button
    ><ActionFeedback
      note={vm.actionNotes['preview-add']}
    />{#if vm.goalTarget && vm.preview.goalSelection}<Button
        secondary
        disabled={vm.groupGoalBusy}
        onclick={() => void vm.setGroupGoal(vm.preview.goalSelection)}
        >{vm.groupGoalBusy ? ui.groupGoalSaving : ui.groupGoalUse}</Button
      >{#if vm.groupGoalError}<p role="alert">{vm.groupGoalError}</p>{/if}{/if}</Sheet
  >{/if}
{#if vm.removeTarget}<Sheet title={ui.removeTitle} close={() => (vm.removeTarget = null)}
    ><p>{ui.removeDetail(vm.removeTarget.title)}</p>
    <Button onclick={() => void vm.remove(vm.removeTarget!)}>{ui.remove}</Button><ActionFeedback
      note={vm.actionNotes.remove}
    /><Button secondary onclick={() => (vm.removeTarget = null)}>{ui.keepItem}</Button></Sheet
  >{/if}

{#if vm.undoItem && !vm.practice}<div class="undo-toast" role="status">
    {ui.removed}
    <button class="text-button" onclick={() => void vm.undo()}>{ui.undo}</button><ActionFeedback
      note={vm.actionNotes.undo}
    />
  </div>{/if}
{#if vm.confirmBatch}<Sheet
    title={ui.batchTitle(vm.confirmBatch.length)}
    close={() => (vm.confirmBatch = null)}
    ><Button disabled={vm.busy || vm.batchAdded} onclick={() => void vm.confirmBatchAdd()}
      >{vm.batchAdded ? ui.added : ui.addItems}</Button
    ><ActionFeedback note={vm.actionNotes['batch-add']} /><Button
      secondary
      onclick={() => (vm.confirmBatch = null)}>{vm.batchAdded ? ui.done : ui.cancel}</Button
    ></Sheet
  >{/if}
{#if vm.confirmSignout}<Sheet title={ui.signoutTitle} close={() => (vm.confirmSignout = false)}
    ><p>{ui.signoutDetail}</p>
    <CodeSignoutReminder {vm} /><Button disabled={vm.busy} onclick={() => void vm.signout()}
      >{ui.signOut}</Button
    ><ActionFeedback note={vm.actionNotes.signout} /><Button
      secondary
      onclick={() => (vm.confirmSignout = false)}>{ui.cancel}</Button
    ></Sheet
  >{/if}
{#if !vm.oauthRoute && !vm.awaitingCodeSave && vm.mergePrompt && !vm.mergeDismissed && !vm.discardPrompt}<Sheet
    title={ui.mergeTitle(vm.live.length)}
    close={() => (vm.mergeDismissed = true)}
    ><p>{ui.mergeHistoryDetail}</p>
    <Button onclick={() => void vm.acceptMerge()}>{ui.mergeAdd}</Button><Button
      secondary
      onclick={() => (vm.discardPrompt = true)}>{ui.keepSeparate}</Button
    ></Sheet
  >{/if}
{#if vm.discardPrompt}<Sheet title={ui.discardTitle} close={() => (vm.discardPrompt = false)}
    ><p>{ui.discardDetail}</p>
    <Button onclick={() => void vm.discardLocal()}>{ui.discardLocal}</Button><Button
      secondary
      onclick={() => (vm.discardPrompt = false)}>{ui.cancel}</Button
    ></Sheet
  >{/if}
{#if vm.confirmEverywhere}<Sheet
    title={ui.signoutEverywhereTitle}
    close={() => (vm.confirmEverywhere = false)}
    ><p>
      {vm.account?.hasCode && !vm.account?.hasEmail && !vm.account?.hasGoogle
        ? ui.codeAccount.everywhereDetail
        : ui.signoutEverywhereDetail}
    </p>
    <CodeSignoutReminder {vm} /><Button disabled={vm.busy} onclick={() => void vm.signout(true)}
      >{ui.signoutEverywhere}</Button
    ><ActionFeedback note={vm.actionNotes['signout-everywhere']} /><Button
      secondary
      onclick={() => (vm.confirmEverywhere = false)}>{ui.cancel}</Button
    ></Sheet
  >{/if}
