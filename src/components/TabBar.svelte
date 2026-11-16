<script lang="ts">
  import { hapticOverlay } from '../haptic-overlay';
  import { copy } from '../config/copy';
  let {
    active,
    onchange,
    pendingRequests = 0,
  }: { active: string; onchange: (tab: string) => void; pendingRequests?: number } = $props();
</script>

<nav class="tabbar" aria-label={copy.navigationLabel}>
  {#each [copy.today, copy.library, copy.discover, copy.groups.heading] as tab}
    <button
      use:hapticOverlay
      aria-label={tab}
      aria-describedby={tab === copy.groups.heading && pendingRequests
        ? 'groups-tab-pending'
        : undefined}
      class:active={active === tab}
      aria-current={active === tab ? 'page' : undefined}
      onclick={() => onchange(tab)}
    >
      <span class="tab-icon"
        ><svg viewBox="0 0 24 24" aria-hidden="true">
          {#if tab === copy.today}<circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
          {:else if tab === copy.library}<path d="M4 4h6v16H4zM13 5l5-1 3 15-5 1zM4 8h6M14 9l5-1" />
          {:else if tab === copy.discover}<circle cx="12" cy="12" r="9" /><path
              d="m16 8-2 6-6 2 2-6z"
            />
          {:else}<circle cx="12" cy="12" r="9" /><circle cx="12" cy="9" r="2.5" /><path
              d="M7 18v-1a5 5 0 0 1 10 0v1"
            />{/if}
        </svg>{#if tab === copy.groups.heading && pendingRequests}<span
            class="tab-badge"
            aria-hidden="true">{pendingRequests > 99 ? '99+' : pendingRequests}</span
          >{/if}</span
      >{tab}
    </button>
  {/each}
  {#if pendingRequests}<span id="groups-tab-pending" hidden
      >{copy.groups.pendingCount(pendingRequests)}</span
    >{/if}
</nav>
