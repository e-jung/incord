<script lang="ts">
import {copy} from '../config/copy';
let {active,onchange}:{active:string,onchange:(tab:string)=>void}=$props();
</script>
<nav class="tabbar" aria-label={copy.navigationLabel}>
{#each [copy.today,copy.library,copy.discover] as tab}
<button class:active={active===tab} aria-current={active===tab?'page':undefined} onclick={()=>onchange(tab)}>
<svg viewBox="0 0 24 24" aria-hidden="true">
{#if tab===copy.today}<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>
{:else if tab===copy.library}<path d="M4 4h6v16H4zM13 5l5-1 3 15-5 1zM4 8h6M14 9l5-1"/>
{:else}<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>{/if}
</svg>{tab}
</button>
{/each}
</nav>
