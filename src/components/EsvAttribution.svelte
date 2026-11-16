<script lang="ts">
  import { esvAttribution as ui } from '../content';
  let { translation, full = false }: { translation?: string; full?: boolean } = $props();
</script>

{#if translation === 'ESV'}<small class="esv-attribution"
    >{#if full}{ui.copyright}{' '}{/if}<a
      href={ui.url}
      aria-label={full ? 'esv.org' : ui.label}
      target="_blank"
      rel="noreferrer">{full ? 'esv.org' : ui.label}</a
    ></small
  >{/if}
