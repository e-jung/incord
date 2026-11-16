<script lang="ts">
  import { onDestroy } from 'svelte';
  import { hapticOverlay, trackTapGesture } from '../haptic-overlay';
  import { ui } from '../config/copy';
  let {
    onkey,
    disabled = false,
    hasNumbers = false,
  }: {
    onkey: (key: string) => void;
    disabled?: boolean;
    hasNumbers?: boolean;
  } = $props();
  let pressed = $state<string>(ui.empty),
    numbers = $state(false);
  const rows = $derived(
    numbers && hasNumbers
      ? ui.keyboardDigitRows
      : [ui.keyboardTopRow, ui.keyboardMiddleRow, ui.keyboardBottomRow],
  );
  let pressedTimer: ReturnType<typeof setTimeout>;
  // Only empty row space reaches this handler. Native overlay clicks stop
  // propagation; button clicks already have their own exactly-once action.
  function gapTarget(row: HTMLDivElement) {
    const gesture = trackTapGesture(row);
    const click = (event: MouseEvent) => {
      if (disabled || event.target !== row) return;
      if (!gesture.accepts()) {
        event.stopPropagation();
        return;
      }
      const keys = [...row.querySelectorAll<HTMLButtonElement>('button.key')];
      const nearest = keys.reduce<HTMLButtonElement | undefined>((best, key) => {
        const distance = (button: HTMLButtonElement) => {
          const box = button.getBoundingClientRect();
          return Math.max(box.left - event.clientX, event.clientX - box.right, 0);
        };
        // Edge distance splits unequal-width keys' gaps exactly like native overlays.
        return !best || distance(key) < distance(best) ? key : best;
      }, undefined);
      nearest?.click();
    };
    row.addEventListener('click', click);
    return {
      destroy() {
        gesture.destroy();
        row.removeEventListener('click', click);
      },
    };
  }
  function press(key: string) {
    clearTimeout(pressedTimer);
    pressed = key;
    onkey(key);
    pressedTimer = setTimeout(() => (pressed = ui.empty), 150);
  }
  onDestroy(() => clearTimeout(pressedTimer));
</script>

<div class="keyboard" aria-label={ui.keyboardLabel}>
  {#each rows as row, index}
    <div
      class="keyrow"
      use:gapTarget
      class:digits={numbers && hasNumbers}
      class:has-toggle={index === 2 && hasNumbers}
    >
      {#if index === 2 && hasNumbers}<button
          use:hapticOverlay
          class="key keyboard-toggle"
          {disabled}
          aria-label={numbers ? ui.showLetters : ui.showNumbers}
          aria-pressed={numbers}
          onclick={() => (numbers = !numbers)}
          >{numbers ? ui.keyboardLetters : ui.keyboardDigits}</button
        >{/if}
      {#each row.split(ui.empty) as key}
        <button
          class="key"
          use:hapticOverlay
          aria-label={key}
          class:number-key={numbers && hasNumbers}
          class:pressed={pressed === key}
          {disabled}
          onclick={() => press(key)}>{key}</button
        >
      {/each}
    </div>
  {/each}
</div>
