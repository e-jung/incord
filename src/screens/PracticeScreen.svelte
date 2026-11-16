<script lang="ts">
  import ActionFeedback from '../components/ActionFeedback.svelte';

  import EsvAttribution from '../components/EsvAttribution.svelte';

  import { copy as ui, sourceLabel, collectionColor } from '../config/copy';

  import Button from '../components/Button.svelte';

  import Sheet from '../components/Sheet.svelte';
  import StepDots from '../components/StepDots.svelte';

  import Keyboard from '../components/Keyboard.svelte';
  import VerseText from '../components/VerseText.svelte';

  import type { AppRuntime } from '../controllers/state.svelte';

  let {
    vm,
  }: {
    vm: Pick<
      AppRuntime,
      | 'practice'
      | 'loadingPassage'
      | 'learned'
      | 'review'
      | 'nextDue'
      | 'loadNext'
      | 'session'
      | 'rehearsal'
      | 'restart'
      | 'unlockPractice'
      | 'practiceRegion'
      | 'result'
      | 'confirmLeavePractice'
      | 'requestClosePractice'
      | 'attemptStep'
      | 'know'
      | 'position'
      | 'titleExpanded'
      | 'words'
      | 'actionNotes'
      | 'showPracticeInstruction'
      | 'typedLetter'
      | 'typedSlip'
      | 'tapUndo'
      | 'undoTap'
      | 'mask'
      | 'visualSlips'
      | 'practiceAnnouncement'
      | 'key'
      | 'completing'
      | 'resultTitle'
      | 'continueResult'
      | 'resultDetail'
      | 'resultLearned'
    >;
  } = $props();
</script>

{#if vm.practice}
  {#if vm.loadingPassage}<p role="status">{ui.loadingBody}</p>{/if}
  {#if vm.learned}<section class="learned">
      <svg class="learned-check" viewBox="0 0 48 48" aria-hidden="true"
        ><path d="M10 25l9 9L39 14" /></svg
      >
      <h1>{vm.review ? ui.reviewed : ui.learned}</h1>
      <article class="keepsake" style:background={collectionColor(vm.practice)}>
        <p>{vm.practice.text}</p>
        <footer>
          <b>{vm.practice.title}</b>{#if vm.practice.translation === 'ESV'}<EsvAttribution
              translation={vm.practice.translation}
            />
          {:else}<small class:translation-badge={!!vm.practice.translation}
              >{sourceLabel(vm.practice)}</small
            >{/if}
        </footer>
      </article>
      {#if vm.nextDue}<small>{ui.nextReviewPrefix}{vm.nextDue}</small>{/if}<Button
        onclick={vm.loadNext}>{vm.session.length ? ui.nextItem : ui.backToToday}</Button
      ><Button
        secondary
        onclick={() => {
          vm.learned = false;
          vm.rehearsal = true;
          vm.review = false;
          vm.restart();
        }}>{ui.practiceOnceMore}</Button
      >
    </section>
  {:else}<section
      class="practice"
      onpointerdown={vm.unlockPractice}
      ontouchstart={vm.unlockPractice}
      onpointerup={vm.unlockPractice}
      ontouchend={vm.unlockPractice}
      onclick={vm.unlockPractice}
      bind:this={vm.practiceRegion}
      tabindex="-1"
      aria-label={ui.practiceRegionLabel}
      inert={vm.result || vm.confirmLeavePractice}
      aria-hidden={vm.result || vm.confirmLeavePractice}
    >
      <header>
        <button class="icon" aria-label={ui.closePractice} onclick={vm.requestClosePractice}
          >×</button
        ><StepDots step={vm.attemptStep} />{#if vm.attemptStep === 1 && !vm.review}<Button
            secondary
            onclick={vm.know}>{ui.knowThis}</Button
          >{:else}<button class="icon" aria-label={ui.restartStep} onclick={vm.restart}>↻</button
          >{/if}
      </header>
      <div
        class="prompt"
        class:collapsed={vm.position > 0 && !vm.titleExpanded}
        class:expanded={vm.titleExpanded}
      >
        <small
          >{vm.review
            ? ui.reviewBlankRecall
            : ui.stepPrefix +
              vm.attemptStep +
              ui.stepOfFour +
              [ui.empty, ui.readAlong, ui.fewWordsHidden, ui.almostFromMemory, ui.fromMemory][
                vm.attemptStep
              ]}</small
        >
        <h1 data-title={vm.practice.title}>
          <div class="prompt-title-scroll">
            <button
              class="prompt-title"
              aria-expanded={vm.titleExpanded}
              onclick={() => (vm.titleExpanded = !vm.titleExpanded)}>{vm.practice.title}</button
            >
          </div>
        </h1>
        {#if vm.practice.translation === 'ESV'}<EsvAttribution
            translation={vm.practice.translation}
          />{:else}<small class:translation-badge={!!vm.practice.translation}
            >{sourceLabel(vm.practice)}</small
          >{/if}
      </div>
      <div class="progress">
        <i style:width={(vm.position / vm.words.length) * 100 + ui.percent}></i>
      </div>
      <ActionFeedback note={vm.actionNotes.practice} />
      <div class="practice-feedback">
        {#if vm.showPracticeInstruction}<small class="practice-instruction"
            >{ui.typeFirstLetters}</small
          >{:else}<span class="practice-letter-slot" aria-hidden="true"
            >{#if vm.typedLetter}<span class="typed-letter" class:slip={vm.typedSlip}
                >{vm.typedLetter}</span
              >{/if}</span
          >{#if vm.tapUndo}<button class="text-button practice-undo" onclick={vm.undoTap}
              >{ui.undo}</button
            >{/if}{/if}
      </div>
      <VerseText
        words={vm.words}
        mask={vm.mask}
        text={vm.practice.text}
        index={vm.position}
        slipped={vm.visualSlips}
      />
      <div class="sr-only" aria-live="polite" aria-atomic="true">
        {vm.practiceAnnouncement || ui.practicePosition(vm.position, vm.words.length)}
      </div>
      {#key vm.practice.id}<Keyboard
          hasNumbers={vm.words.some((word) => /^\d/.test(word))}
          onkey={vm.key}
          disabled={vm.result || vm.completing}
        />{/key}
    </section>{/if}
  {#if vm.result}<Sheet title={vm.resultTitle} close={vm.continueResult}
      ><p>{vm.resultDetail}</p>
      <div class="practice-result">
        <Button onclick={vm.continueResult}
          >{vm.review && !vm.resultLearned
            ? ui.relearnNow
            : vm.rehearsal
              ? ui.done
              : vm.resultLearned
                ? ui.finish
                : ui.continue}</Button
        ><Button
          secondary
          onclick={() => {
            vm.practice = null;
            vm.result = false;
          }}>{vm.review && !vm.resultLearned ? ui.later : ui.closePractice}</Button
        >
      </div></Sheet
    >{/if}
{/if}
