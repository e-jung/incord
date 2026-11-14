<script lang="ts">
import {onMount,tick} from 'svelte';
import {copy} from '../config/copy';
import {displayTokens} from '../engine/tokenize';

let {words,mask,index,slipped=[],text='',visibleViewport=false}:{words:string[],mask:boolean[],index:number,slipped?:number[],text?:string,visibleViewport?:boolean}=$props();
let viewport: HTMLDivElement;
let viewportRevision=$state(0);
onMount(()=>{const visual=window.visualViewport;const resize=()=>viewportRevision++;visual?.addEventListener('resize',resize);visual?.addEventListener('scroll',resize);return()=>{visual?.removeEventListener('resize',resize);visual?.removeEventListener('scroll',resize)}});
const rendered=$derived(text?displayTokens(text):words.map(word=>({text:word,separator:' '})));
$effect(()=>{
  const current=index;
  // Also reset scroll when a new passage/step starts at the same word index.
  words; mask; viewportRevision; visibleViewport;
  let cancelled=false;
  void tick().then(()=>{
    if(cancelled||!viewport)return;
    const word=viewport.querySelector<HTMLElement>(`[data-word="${current}"]`);
    if(!word)return;
    const view=viewport.getBoundingClientRect(),rect=word.getBoundingClientRect();
    const visual=window.visualViewport;
    const visibleTop=Math.max(view.top,visual?.offsetTop||0),visibleBottom=Math.min(view.bottom,(visual?.offsetTop||0)+(visual?.height||window.innerHeight));
    const target=visibleViewport?Math.max(visibleTop,Math.min(visibleBottom,(visual?.offsetTop||0)+(visual?.height||window.innerHeight)*0.48)):view.top+viewport.clientHeight/3;
    const top=viewport.scrollTop+rect.top-target;
    viewport.scrollTo({top:Math.max(0,top),behavior:visibleViewport||rect.top<view.top||rect.bottom>view.bottom||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });
  return()=>{cancelled=true};
});
</script>
<div bind:this={viewport} class="verse" aria-label={copy.memoryText}>{#each words as word,i}<span class:hidden={mask[i]&&i>=index} class:current={i===index} class:done={i<index} class:slip={slipped.includes(i)} data-word={i} data-hidden={mask[i]&&i>=index}>{rendered[i]?.text??word}</span>{rendered[i]?.separator??' '}{/each}</div>
