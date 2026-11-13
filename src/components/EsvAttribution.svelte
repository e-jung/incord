<script lang="ts">
 import {esvAttribution as ui} from '../content';
 let {translation,full=false}:{translation?:string,full?:boolean}=$props();
</script>
{#if translation==='ESV'}<small class="esv-attribution"><a href={ui.url} aria-label={ui.label} target="_blank" rel="noreferrer">{full?ui.label:ui.short}</a>{#if full} · {ui.copyright}{/if}</small>{/if}
