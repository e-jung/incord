<script lang="ts">
import {ui} from '../config/copy';
import type {Snippet} from 'svelte';
let {title,subtitle=ui.empty,onclick,children}:{title:string,subtitle?:string,onclick?:()=>void,children?:Snippet}=$props();
</script>
{#snippet body()}
 <span class="row-copy"><b>{title}</b>{#if subtitle}<small>{subtitle}</small>{/if}</span>
 {#if children}{@render children()}{/if}
 {#if onclick}<span aria-hidden="true">›</span>{/if}
{/snippet}
{#if onclick}<button class="row" {onclick}>{@render body()}</button>
{:else}<div class="row">{@render body()}</div>{/if}
