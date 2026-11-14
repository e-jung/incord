<script lang="ts">
import {onMount} from 'svelte';
import {copy as ui} from '../config/copy';
import {practiceCharacter} from '../native-typing';
let {onkey,onpeek,disabled=false}:{onkey:(key:string)=>void,onpeek:()=>void,disabled?:boolean}=$props();
let input:HTMLInputElement;
let composing=false;
export function focus(){if(input?.isConnected)input.focus({preventScroll:true})}
function commit(){
 const value=input.value;input.value='';
 const character=practiceCharacter(value);
 if(character&&!disabled)onkey(character);
}
function beforeInput(event:InputEvent){
 // Newline is not an answer and must not submit/navigate on mobile keyboards.
 if(event.inputType==='insertLineBreak'||event.inputType==='insertParagraph')event.preventDefault();
}
function inputChanged(event:Event){if(!composing&&!(event as InputEvent).isComposing)commit()}
function peek(){onpeek();focus()}
onMount(()=>{focus();return()=>input?.blur()});
</script>
<div class="native-keyboard">
 <button class="peek" aria-label={ui.peek} {disabled} onmousedown={event=>event.preventDefault()} onclick={peek}>{ui.peek}</button>
 <input bind:this={input} class="native-typing-input" aria-label={ui.typeFirstLetters} placeholder={ui.typeFirstLetters} type="text" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck={false} inputmode="text" enterkeyhint="next" onbeforeinput={beforeInput} oninput={inputChanged} oncompositionstart={()=>composing=true} oncompositionend={()=>{composing=false;commit()}}/>
</div>
