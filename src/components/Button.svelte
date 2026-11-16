<script lang="ts">
  import { hapticOverlay } from '../haptic-overlay';
  import { ui } from '../config/copy';
  import type { Snippet } from 'svelte';
  let {
    children,
    onclick,
    secondary = false,
    disabled = false,
    type = ui.buttonType,
    ariaExpanded,
    ariaControls,
  }: {
    children: Snippet;
    onclick?: () => void;
    secondary?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
    ariaExpanded?: boolean;
    ariaControls?: string;
  } = $props();
</script>

<button
  use:hapticOverlay
  class:secondary
  {onclick}
  {disabled}
  {type}
  aria-expanded={ariaExpanded}
  aria-controls={ariaControls}>{@render children()}</button
>
