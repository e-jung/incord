<script lang="ts">
import {hapticOverlay} from '../haptic-overlay';
import {ui} from '../config/copy';
import type {Snippet} from 'svelte';let {children,onclick,secondary=false,disabled=false,type=ui.buttonType}:{children:Snippet,onclick?:()=>void,secondary?:boolean,disabled?:boolean,type?:'button'|'submit'}=$props();</script>
<button use:hapticOverlay class:secondary {onclick} {disabled} {type}>{@render children()}</button>
