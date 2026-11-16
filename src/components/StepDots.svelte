<script lang="ts">
  import { ui } from '../config/copy';
  let { step = 1 }: { step?: number } = $props();
</script>

<span class="step-dots" aria-label={ui.stepPrefix + step + ui.ofFourSuffix}
  >{#each [1, 2, 3, 4] as n}<i class:complete={n < step} class:current={n === step}
    ></i>{/each}</span
>
