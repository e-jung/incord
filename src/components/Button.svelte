<script lang="ts">
import {ui} from '../config/ui';
import type {Snippet} from 'svelte';let {children,onclick,secondary=false,disabled=false,type=ui.c195}:{children:Snippet,onclick?:()=>void,secondary?:boolean,disabled?:boolean,type?:'button'|'submit'}=$props();</script>
<button class:secondary {onclick} {disabled} {type}>{@render children()}</button>
