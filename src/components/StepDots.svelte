<script lang="ts">
import {ui} from '../config/ui';
let {step=1}:{step?:number}=$props();</script><span class="step-dots" aria-label={ui.c017+step+ui.c206}>{#each [1,2,3,4] as n}<i class:complete={n<step} class:current={n===step}></i>{/each}</span>
