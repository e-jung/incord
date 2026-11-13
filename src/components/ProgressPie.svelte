<script lang="ts">
import {ui} from '../config/copy';
let {percent=0}:{percent?:number}=$props();
</script>
<span class="progress-pie" style:--n={Math.max(0,Math.min(100,percent))} aria-label={Math.round(percent)+ui.percentLearned}></span>
