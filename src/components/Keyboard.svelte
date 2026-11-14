<script lang="ts">
import {onDestroy} from 'svelte';
import {hapticOverlay} from '../haptic-overlay';
import {ui} from '../config/copy';
let {onkey,onpeek,disabled=false,hasNumbers=false}:{
  onkey:(key:string)=>void,onpeek:()=>void,disabled?:boolean,hasNumbers?:boolean
}=$props();
let pressed=$state<string>(ui.empty),numbers=$state(false);
const rows=$derived(numbers&&hasNumbers?ui.keyboardDigitRows:[ui.keyboardTopRow,ui.keyboardMiddleRow,ui.keyboardBottomRow]);
let pressedTimer: ReturnType<typeof setTimeout>;
// Only empty row space reaches this handler. Native overlay clicks stop
// propagation; button clicks already have their own exactly-once action.
function gapTarget(row:HTMLDivElement){
 const click=(event:MouseEvent)=>{
  if(disabled||event.target!==row)return;
  const keys=[...row.querySelectorAll<HTMLButtonElement>('button.key')];
  const nearest=keys.reduce<HTMLButtonElement|undefined>((best,key)=>{
   const box=key.getBoundingClientRect(),prior=best?.getBoundingClientRect();
   return !prior||Math.abs(event.clientX-box.left-box.width/2)<Math.abs(event.clientX-prior.left-prior.width/2)?key:best;
  },undefined);
  nearest?.click();
 };
 row.addEventListener('click',click);
 return {destroy(){row.removeEventListener('click',click)}};
}
function press(key:string){clearTimeout(pressedTimer);pressed=key;onkey(key);pressedTimer=setTimeout(()=>pressed=ui.empty,150)}
onDestroy(()=>clearTimeout(pressedTimer));
</script>
<div class="keyboard" aria-label={ui.keyboardLabel}>
  {#each rows as row}
    <div class="keyrow" use:gapTarget class:digits={numbers&&hasNumbers}>
      {#each row.split(ui.empty) as key}
        <button class="key" use:hapticOverlay aria-label={key} class:number-key={numbers&&hasNumbers} class:pressed={pressed===key} {disabled} onclick={()=>press(key)}>{key}</button>
      {/each}
    </div>
  {/each}
  <div class="keyrow keyboard-bottom">
    <button class="peek" use:hapticOverlay aria-label={ui.peek} {disabled} onclick={onpeek}>{ui.peek}</button>
    {#if hasNumbers}<button use:hapticOverlay class="keyboard-toggle" {disabled} aria-label={numbers?ui.showLetters:ui.showNumbers} aria-pressed={numbers} onclick={()=>numbers=!numbers}>{numbers?ui.keyboardLetters:ui.keyboardDigits}</button>{/if}
    <span class="keyboard-hint">{ui.typeFirstLetters}</span>
  </div>
</div>
