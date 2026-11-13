<script lang="ts">
import {ui} from '../config/ui';
let {active,onchange}:{active:string,onchange:(tab:string)=>void}=$props();</script><nav class="tabbar" aria-label={ui.c207}>{#each [[ui.c043,ui.c208],[ui.c044,ui.c209],[ui.c046,ui.c210]] as [tab,icon]}<button class:active={active===tab} onclick={()=>onchange(tab)}><span aria-hidden="true">{icon}</span>{tab}</button>{/each}</nav>
