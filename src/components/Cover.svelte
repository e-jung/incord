<script lang="ts">
import {motifs} from "../config/design";
import {ui} from '../config/ui';
let {title,subtitle=ui.c019,color=0,onclick,large=false,progress=0}:{title:string,subtitle?:string,color?:number,onclick?:()=>void,large?:boolean,progress?:number}=$props();</script>
<button class="cover" class:large style:--c={ui.c196+((color%5+5)%5+1)+ui.c197} {onclick}><svg viewBox="0 0 100 100" aria-hidden="true"><path d={motifs[(color%5+5)%5]}/></svg><b>{title}</b><small>{subtitle}</small>{#if progress>0}<span class="pie" style:--n={progress} aria-label={progress+ui.c198}></span>{/if}</button>
