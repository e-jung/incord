<script lang="ts">
  import { tick } from 'svelte';
  import { copy } from '../config/copy';
  import { displayTokens } from '../engine/tokenize';

  let {
    words,
    mask,
    index,
    slipped = [],
    text = '',
  }: {
    words: string[];
    mask: boolean[];
    index: number;
    slipped?: number[];
    text?: string;
  } = $props();
  let viewport: HTMLDivElement;
  const rendered = $derived(
    text ? displayTokens(text) : words.map((word) => ({ text: word, separator: ' ' })),
  );
  $effect(() => {
    const current = index;
    // Also reset scroll when a new passage/step starts at the same word index.
    words;
    mask;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled || !viewport) return;
      const word = viewport.querySelector<HTMLElement>(`[data-word="${current}"]`);
      if (!word) return;
      const view = viewport.getBoundingClientRect(),
        rect = word.getBoundingClientRect();
      const target = view.top + viewport.clientHeight / 3;
      const top = viewport.scrollTop + rect.top - target;
      viewport.scrollTo({
        top: Math.max(0, top),
        behavior:
          rect.top < view.top ||
          rect.bottom > view.bottom ||
          matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
      });
    });
    return () => {
      cancelled = true;
    };
  });
</script>

<div bind:this={viewport} class="verse" aria-label={copy.memoryText}>
  {#each words as word, i}<span
      class:hidden={mask[i] && i >= index}
      class:current={i === index}
      class:done={i < index}
      class:slip={slipped.includes(i)}
      aria-hidden={mask[i] && i >= index ? true : undefined}
      data-word={i}
      data-hidden={mask[i] && i >= index}>{rendered[i]?.text ?? word}</span
    >{rendered[i]?.separator ?? ' '}{/each}
</div>
