<script lang="ts">
import {ui} from '../config/copy';
import {onMount,type Snippet} from 'svelte';
let {title,children,close}:{title:string,children:Snippet,close?:()=>void}=$props();
let node:HTMLDivElement;
const focusable=()=>Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')).filter(element=>element.getAttribute('aria-hidden')!=='true'&&element.tabIndex!==-1);
onMount(()=>{const before=document.activeElement as HTMLElement; (focusable()[0]||node).focus({preventScroll:true});return()=>before?.isConnected&&before.focus({preventScroll:true})});
function keyboard(event:KeyboardEvent){
 if(event.key==='Escape'&&close){event.preventDefault();event.stopPropagation();close()}
 if(event.key==='Tab'){const all=focusable(),first=all[0],last=all.at(-1);if(!first){event.preventDefault();node.focus()}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last!.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
}
</script>
<svelte:window onkeydown={keyboard}/>
<div class="scrim">{#if close}<button class="sheet-backdrop" tabindex="-1" aria-label="Dismiss dialog" onclick={close}></button>{/if}<div bind:this={node} class="sheet" role="dialog" tabindex="-1" aria-modal="true" aria-label={title}><header><h2>{title}</h2>{#if close}<button class="icon" onclick={close} aria-label={ui.closeDialog}>×</button>{/if}</header>{@render children()}</div></div>
