<script lang="ts">
import {ui} from '../config/ui';
import type {Snippet} from 'svelte';let {title,children,close}:{title:string,children:Snippet,close?:()=>void}=$props();</script><div class="scrim"><div class="sheet" role="dialog" tabindex="-1" aria-modal="true" aria-label={title}><header><h2>{title}</h2>{#if close}<button class="icon" onclick={close} aria-label={ui.c205}>×</button>{/if}</header>{@render children()}</div></div>
