<script lang="ts">
 import {tick} from 'svelte';
 let {note}: {note?: {text:string;error?:boolean}}=$props();
 let result=$state<HTMLParagraphElement>();
 $effect(()=>{const text=note?.text;if(!text)return;void tick().then(()=>{if(note?.text!==text||!result)return;const rect=result.getBoundingClientRect(),viewport=window.visualViewport;const top=(viewport?.offsetTop||0)+12;const bottom=Math.min((viewport?.offsetTop||0)+(viewport?.height||innerHeight)-12,document.querySelector('.tabbar')?.getBoundingClientRect().top??Infinity)-12;if(rect.bottom>bottom||rect.top<top){const container=result.closest('.sheet');if(container)result.scrollIntoView({block:'nearest'});else window.scrollBy({top:rect.bottom>bottom?rect.bottom-bottom:rect.top-top,behavior:'instant'})}})});
</script>
<p bind:this={result} class:action-feedback={!!note?.text} class:sr-only={!note?.text} class:failed={note?.error} aria-live="polite" aria-atomic="true" role={note?.text?(note.error?'alert':'status'):undefined}>{note?.text||''}</p>
