<script lang="ts">
import {ui} from '../config/ui';
import type {Snippet} from 'svelte';let {title,subtitle=ui.c019,onclick,children}:{title:string,subtitle?:string,onclick?:()=>void,children?:Snippet}=$props();</script>
<button class="row" {onclick}><span class="row-copy"><b>{title}</b>{#if subtitle}<small>{subtitle}</small>{/if}</span>{#if children}{@render children()}{/if}<span aria-hidden="true">›</span></button>
