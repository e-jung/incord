<script lang="ts">
import {ui} from '../config/ui';

let {words,mask,index,slipped=[],text=ui.c019}:{words:string[],mask:boolean[],index:number,slipped?:number[],text?:string}=$props();
const rendered=$derived.by(()=>{if(!text)return words;let cursor=0;return words.map((word,i)=>{const start=text.indexOf(word,cursor);if(start<0)return word;const next=i+1<words.length?text.indexOf(words[i+1],start+word.length):text.length;const prefix=i===0?text.slice(0,start):ui.c019;cursor=start+word.length;return prefix+text.slice(start,next<0?cursor:next).trimEnd()})});
</script><div class="verse" aria-label={ui.c211}>{#each words as word,i}<span class:hidden={mask[i]&&i>=index} class:current={i===index} class:done={i<index} class:slip={slipped.includes(i)} data-word={i} data-hidden={mask[i]&&i>=index}>{rendered[i]}</span>{ui.c212}{/each}</div>
