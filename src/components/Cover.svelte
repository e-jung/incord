<script lang="ts">
import {motifs} from "../config/design";
import {ui} from '../config/copy';
let {title,subtitle=ui.empty,color=0,onclick,large=false,compact=false,progress=0,translation}:{title:string,subtitle?:string,color?:number,onclick?:()=>void,large?:boolean,compact?:boolean,progress?:number,translation?:string}=$props();</script>
{#snippet content()}
<svg viewBox="0 0 100 100" aria-hidden="true"><path d={motifs[(color%5+5)%5]}/></svg>{#if compact}<h1>{title}</h1>{:else}<b>{title}</b>{/if}<small>{subtitle}</small>{#if translation}<small class="translation-badge card-badge">{translation}</small>{/if}{#if progress>0}<span class="pie" style:--n={progress} aria-label={progress+ui.percentLearned}></span>{/if}
{/snippet}
{#if compact}<div class="cover compact" style:--c={ui.colorVariablePrefix+((color%5+5)%5+1)+ui.closingParenthesis}>{@render content()}</div>
{:else}<button class="cover" class:large style:--c={ui.colorVariablePrefix+((color%5+5)%5+1)+ui.closingParenthesis} {onclick}>{@render content()}</button>{/if}
