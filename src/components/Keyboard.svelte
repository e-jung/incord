<script lang="ts">
import {ui} from '../config/copy';
let {onkey,onpeek,disabled=false,hasNumbers=false}:{
  onkey:(key:string)=>void,onpeek:()=>void,disabled?:boolean,hasNumbers?:boolean
}=$props();
let pressed=$state<string>(ui.empty),numbers=$state(false);
const rows=$derived(numbers&&hasNumbers?ui.keyboardDigitRows:[ui.keyboardTopRow,ui.keyboardMiddleRow,ui.keyboardBottomRow]);
function press(key:string){pressed=key;onkey(key);setTimeout(()=>pressed=ui.empty,150)}
</script>
<div class="keyboard" aria-label={ui.keyboardLabel}>
  {#each rows as row}
    <div class="keyrow" class:digits={numbers&&hasNumbers}>
      {#each row.split(ui.empty) as key}
        <button class="key" class:number-key={numbers&&hasNumbers} class:pressed={pressed===key} {disabled} onclick={()=>press(key)}>{key}</button>
      {/each}
    </div>
  {/each}
  <div class="keyrow keyboard-bottom">
    <button class="peek" {disabled} onclick={onpeek}>{ui.peek}</button>
    {#if hasNumbers}<button class="keyboard-toggle" {disabled} aria-label={numbers?ui.showLetters:ui.showNumbers} aria-pressed={numbers} onclick={()=>numbers=!numbers}>{numbers?ui.keyboardLetters:ui.keyboardDigits}</button>{/if}
    <span class="keyboard-hint">{ui.typeFirstLetters}</span>
  </div>
</div>
