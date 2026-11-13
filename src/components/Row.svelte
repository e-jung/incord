<script lang="ts">
import EsvAttribution from './EsvAttribution.svelte';
import {ui} from '../config/copy';
import type {Snippet} from 'svelte';
let {title,subtitle=ui.empty,onclick,children,trailing,translation}:{title:string,subtitle?:string,onclick?:()=>void,children?:Snippet,trailing?:Snippet,translation?:string}=$props();
</script>
{#snippet body()}
 <span class="row-copy"><b>{title}</b>{#if subtitle}<small>{subtitle}</small>{/if}</span>
 {#if children}{@render children()}{/if}
 {#if onclick}<span aria-hidden="true">›</span>{/if}
{/snippet}
{#if translation==='ESV'}
 <div class="row source-row"><span class="row-copy">{#if onclick}<button class="row-title" {onclick}><b>{title}</b></button>{:else}<b>{title}</b>{/if}<EsvAttribution {translation}/>{#if subtitle}<small>{subtitle}</small>{/if}</span>{#if children}{@render children()}{/if}{#if trailing}{@render trailing()}{/if}</div>
{:else if onclick&&trailing}<div class="row"><button class="row-main" {onclick}>{@render body()}</button>{@render trailing()}</div>
{:else if onclick}<button class="row" {onclick}>{@render body()}</button>
{:else}<div class="row">{@render body()}</div>{/if}
