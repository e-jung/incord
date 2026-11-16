<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { api, type Settings } from '../store';
  import { copy as ui } from '../config/copy';
  import Sheet from './Sheet.svelte';
  import WeekDots from './WeekDots.svelte';

  type Role = 'owner' | 'admin' | 'member';
  type Goal = {
    title: string;
    total: number;
    itemIds: string[];
    selection: { translation: string; kind?: string; id?: string };
  };
  type Pending = { id: string; name: string; ownerName: string; requestedAt: number };
  type Summary = {
    id: string;
    name: string;
    role: Role;
    memberCount: number;
    goal: Goal | null;
    pending?: { id: string; name: string }[];
  };
  type Member = {
    id: string;
    name: string;
    role: Role;
    self: boolean;
    weekDays: string[];
    weeklyGoal: number;
    learnedCount: number;
    streak: number;
    titles?: { title: string; translation?: string; learned: boolean }[];
    goalStatus: string;
    goalLearned: number;
    goalTotal: number;
  };
  type Group = Summary & {
    members: Member[];
    pending?: { id: string; name: string }[];
    approveNewMembers: boolean;
    weeklyPush: boolean;
  };
  type Invite = { code: string; url: string; expiresAt: number; maxUses: number };
  type Note = { text: string; error?: boolean };
  type Confirmation = {
    kind: 'delete' | 'leave' | 'remove' | 'transfer';
    member?: Member;
    groupName: string;
    done?: boolean;
  };
  let {
    account,
    settings,
    onSync,
    onChooseGoal,
    onSignIn,
    pendingCode = '',
    onJoined,
    initialGroupId = '',
    onSave,
    onDialogChange = () => {},
    onSelect = () => {},
    onAttention = () => {},
  }: {
    account: any | null;
    settings: Settings;
    onSync: () => Promise<void>;
    onChooseGoal: (groupId: string) => void;
    onSignIn: () => void;
    pendingCode?: string;
    onJoined: () => void;
    initialGroupId?: string;
    onSave?: () => Promise<void>;
    onDialogChange?: (close: (() => void) | null) => void;
    onSelect?: (id: string) => void;
    onAttention?: (attention?: {
      pendingRequests: number;
      prayersToday: number;
      goalsNearlyDone: number;
      groupId?: string;
    }) => void;
  } = $props();
  let pendingMemberships = $state<Pending[]>([]);
  let groups = $state<Summary[]>([]),
    group = $state<Group | null>(null),
    selected = $state('');
  let activeIdentity = $state(''),
    loading = $state(false),
    listed = $state(false),
    detailLoading = $state(false);
  let busy = $state(''),
    notes = $state<Record<string, Note>>({}),
    invite = $state<Invite | null>(null);
  let name = $state(''),
    code = $state(''),
    approval = $state(false),
    expiresDays = $state(14),
    maxUses = $state(20);
  let confirmation = $state<Confirmation | null>(null);
  let inviteInput = $state<HTMLInputElement>(),
    nameInput = $state<HTMLInputElement>(),
    codeInput = $state<HTMLInputElement>(),
    panel = $state<HTMLElement>();
  let formsOpen = $state(false);
  let pendingReceipts = $state<
    Record<string, { member: { id: string; name: string }; index: number }>
  >({});
  const pendingRows = $derived.by(() => {
    const rows = [...(group?.pending || [])];
    for (const [key, receipt] of Object.entries(pendingReceipts)) {
      if (notes[key] && !rows.some((member) => member.id === receipt.member.id))
        rows.splice(receipt.index, 0, receipt.member);
    }
    return rows;
  });
  const noteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let copyRequest = 0;
  let epoch = 0,
    listRequest = 0,
    detailRequest = 0,
    alive = true,
    attemptedInvite = '';
  const manager = $derived(group?.role === 'owner' || group?.role === 'admin');
  const owner = $derived(group?.role === 'owner');
  const visible = $derived(!!account && String(account.id) === activeIdentity);
  const clearNote = (key: string) => {
    clearTimeout(noteTimers.get(key));
    noteTimers.delete(key);
    const next = { ...notes };
    delete next[key];
    notes = next;
  };
  function clearNotes() {
    for (const timer of noteTimers.values()) clearTimeout(timer);
    noteTimers.clear();
    notes = {};
    pendingReceipts = {};
    copyRequest++;
  }
  function message(key: string, text: string, error = false, persistent = false) {
    clearNote(key);
    notes = { ...notes, [key]: { text, error } };
    const note = notes[key];
    if (!error && !persistent)
      noteTimers.set(
        key,
        setTimeout(() => {
          if (notes[key] !== note) return;
          clearNote(key);
          if (key === 'confirm' && confirmation?.done) confirmation = null;
        }, 3000),
      );
  }
  // Reveal only clipped feedback, leaving focus and already-visible controls in place.
  function revealFeedback(node: HTMLElement, note: Note | undefined) {
    let revision = 0;
    const reveal = async (value: Note | undefined) => {
      const request = ++revision;
      if (!value) return;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true;
      }
      await tick();
      if (!alive || !node.isConnected || request !== revision || !value) return;
      const view = window.visualViewport;
      let top = view?.offsetTop || 0,
        bottom = top + (view?.height || window.innerHeight);
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (/auto|scroll|hidden/.test(getComputedStyle(parent).overflowY)) {
          const box = parent.getBoundingClientRect();
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
      }
      const box = node.getBoundingClientRect();
      if (box.top < top || box.bottom > bottom)
        node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    };
    void reveal(note);
    return {
      update(value: Note | undefined) {
        void reveal(value);
      },
      destroy() {
        revision++;
      },
    };
  }
  const current = (version: number) =>
    alive && version === epoch && !!account && String(account.id) === activeIdentity;
  function weekDotDays(days: string[]) {
    return days.map((value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const [year, month, date] = value.split('-').map(Number);
      return new Date(year, month - 1, date).toLocaleDateString(ui.dateLocale);
    });
  }
  const path = (id: string, suffix = '') => `/groups/${encodeURIComponent(id)}${suffix}`;
  const errorText = (error: unknown) => (error instanceof Error ? error.message : ui.groups.retry);
  function clearDetail() {
    group = null;
    invite = null;
    copyRequest++;
    if (busy !== 'confirm') confirmation = null;
    detailRequest++;
    detailLoading = false;
  }
  function reset(identity: string) {
    epoch++;
    listRequest++;
    clearDetail();
    groups = [];
    pendingMemberships = [];
    selected = '';
    clearNotes();
    confirmation = null;
    busy = '';
    loading = false;
    listed = false;
    name = '';
    code = '';
    formsOpen = !!pendingCode;
    approval = false;
    expiresDays = 14;
    maxUses = 20;
    activeIdentity = identity;
    attemptedInvite = '';
  }
  $effect(() => {
    const identity = account ? String(account.id) : '';
    untrack(() => {
      if (identity !== activeIdentity) {
        reset(identity);
        if (identity) void refresh(true);
      }
    });
  });
  $effect(() => {
    const identity = account ? String(account.id) : '',
      pending = pendingCode,
      running = busy;
    untrack(() => {
      if (
        !running &&
        identity &&
        identity === activeIdentity &&
        pending &&
        attemptedInvite !== `${identity}:${pending}`
      ) {
        attemptedInvite = `${identity}:${pending}`;
        formsOpen = true;
        code = pending;
        void join(pending);
      }
    });
  });
  $effect(() => {
    const id = initialGroupId,
      identity = account ? String(account.id) : '';
    untrack(() => {
      if (id && identity && identity === activeIdentity && selected !== id) {
        clearDetail();
        clearNotes();
        selected = id;
        void loadDetail(id);
      }
    });
  });
  $effect(() => {
    const id = selected;
    if (id) onSelect(id);
  });
  async function openForms(mode: 'create' | 'join') {
    if (!account) {
      onSignIn();
      return;
    }
    formsOpen = true;
    await tick();
    (mode === 'create' ? nameInput : codeInput)?.focus();
  }
  $effect(() => {
    const open = confirmation;
    onDialogChange(
      open
        ? () => {
            if (!busy) confirmation = null;
          }
        : null,
    );
  });
  onMount(() => {
    const focus = () => {
      if (document.visibilityState === 'visible' && visible && !busy && !loading) void refresh();
    };
    let pull: { id: number; x: number; y: number } | null = null;
    const start = (event: TouchEvent) => {
      pull = null;
      if (event.touches.length !== 1 || window.scrollY > 0 || !visible || busy || confirmation)
        return;
      const target = event.target;
      if (
        !(target instanceof Element) ||
        !panel?.closest('.page')?.contains(target) ||
        target.closest('.tabbar,.sheet,input,textarea,select')
      )
        return;
      const touch = event.touches[0];
      pull = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    };
    const end = (event: TouchEvent) => {
      const origin = pull;
      pull = null;
      if (!origin || event.touches.length || window.scrollY > 0 || !visible || busy) return;
      const touch = Array.from(event.changedTouches).find(
        (touch) => touch.identifier === origin.id,
      );
      if (
        touch &&
        touch.clientY - origin.y >= 72 &&
        Math.abs(touch.clientX - origin.x) < (touch.clientY - origin.y) / 2
      )
        void refresh();
    };
    const cancel = () => (pull = null);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchend', end, { passive: true });
    window.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      onDialogChange(null);
      alive = false;
      epoch++;
      clearNotes();
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', cancel);
    };
  });
  async function loadDetail(id: string) {
    const version = epoch,
      request = ++detailRequest;
    detailLoading = true;
    clearNote('detail');
    try {
      const out = await api(path(id));
      if (!current(version) || request !== detailRequest || selected !== id) return;
      group = out.group;
      if (group?.role !== 'owner' && group?.role !== 'admin') invite = null;
    } catch (error) {
      if (current(version) && request === detailRequest && selected === id) {
        group = null;
        invite = null;
        message('detail', errorText(error), true);
      }
    } finally {
      if (current(version) && request === detailRequest) detailLoading = false;
    }
  }
  async function refresh(first = false) {
    if (!account) return;
    const version = epoch,
      request = ++listRequest;
    loading = true;
    clearNote('list');
    try {
      const out = await api('/groups');
      if (!current(version) || request !== listRequest) return;
      listed = true;
      groups = out.groups;
      pendingMemberships = out.pending || [];
      onAttention(
        out.attention || {
          pendingRequests: groups.reduce((sum, item) => sum + (item.pending?.length || 0), 0),
          prayersToday: 0,
          goalsNearlyDone: 0,
        },
      );
      if (selected && !groups.some((g) => g.id === selected)) {
        clearDetail();
        selected = '';
      }
      if (!selected && groups.length)
        selected =
          first && initialGroupId && groups.some((g) => g.id === initialGroupId)
            ? initialGroupId
            : groups[0].id;
      if (selected) await loadDetail(selected);
    } catch (error) {
      if (current(version) && request === listRequest) message('list', errorText(error), true);
    } finally {
      if (current(version) && request === listRequest) loading = false;
    }
  }
  function choose(id: string) {
    if (id === selected) return;
    clearDetail();
    selected = id;
    clearNotes();
    void loadDetail(id);
  }
  function cancelReads() {
    listRequest++;
    detailRequest++;
    loading = false;
    detailLoading = false;
  }
  async function withdraw(id: string) {
    if (busy) return;
    cancelReads();
    const version = epoch;
    busy = 'withdraw:' + id;
    clearNote('withdraw:' + id);
    try {
      await api(path(id, '/leave'), {});
      if (!current(version)) return;
      pendingMemberships = pendingMemberships.filter((item) => item.id !== id);
      await refresh();
      if (current(version)) message('withdraw:' + id, ui.groups.requestWithdrawn);
    } catch (error) {
      if (current(version)) message('withdraw:' + id, errorText(error), true);
    } finally {
      if (current(version)) busy = '';
    }
  }
  async function create() {
    if (busy || !name.trim()) return;
    cancelReads();
    const version = epoch;
    busy = 'create';
    clearNote('create');
    try {
      const out = await api('/groups', { name: name.trim(), approveNewMembers: approval });
      if (!current(version)) return;
      clearDetail();
      group = out.group;
      selected = out.group.id;
      invite = out.invite || null;
      name = '';
      await refresh();
      if (current(version)) message('create', ui.groups.created);
    } catch (error) {
      if (current(version)) message('create', errorText(error), true);
    } finally {
      if (current(version)) busy = '';
    }
  }
  async function join(value = code) {
    if (!account || busy || !value.trim()) return;
    cancelReads();
    const version = epoch;
    busy = 'join';
    clearNote('join');
    try {
      const out = await api('/groups/join', { code: value.trim() });
      if (!current(version)) return;
      if (out.pending) {
        message('join', ui.groups.awaitingApproval(out.ownerName), false, true);
        code = '';
        onJoined();
        await refresh();
        return;
      }
      if (!out.group) throw new Error(ui.groups.inviteInvalid);
      clearDetail();
      group = out.group;
      selected = out.group.id;
      code = '';
      onJoined();
      await refresh();
      if (current(version)) message('join', ui.groups.joined);
    } catch (error) {
      if (current(version)) message('join', errorText(error), true);
    } finally {
      if (current(version)) busy = '';
    }
  }
  async function mutate(
    key: string,
    suffix: string,
    body: unknown = {},
    success: string = ui.groups.saved,
    options: { method?: string; forget?: boolean; sync?: boolean } = {},
  ) {
    if (!group || busy) return;
    cancelReads();
    const version = epoch,
      id = group.id;
    busy = key;
    clearNote(key);
    if (key.startsWith('pending:')) {
      const index = group.pending?.findIndex((member) => key === 'pending:' + member.id) ?? -1;
      if (index >= 0)
        pendingReceipts = { ...pendingReceipts, [key]: { member: group.pending![index], index } };
    }
    try {
      // Start the network request directly in the click handler, including prayer.
      const out = await api(path(id, suffix), body, options.method);
      if (!current(version) || selected !== id) return;
      if (options.forget) {
        clearDetail();
        groups = groups.filter((g) => g.id !== id);
        selected = '';
      }
      if (suffix === '/remove' && group) {
        const memberId = (body as { memberId: string }).memberId;
        group = {
          ...group,
          members: group.members.filter((member) => member.id !== memberId),
          pending: group.pending?.filter((member) => member.id !== memberId),
        };
      }
      if (key === 'confirm' && confirmation) confirmation = { ...confirmation, done: true };
      if (suffix === '/invite' || suffix === '/invite/revoke') {
        copyRequest++;
        clearNote('copy');
        invite = suffix === '/invite' ? out : null;
      }
      if (options.sync) {
        try {
          await onSync();
        } catch {
          if (current(version) && selected === id) message(key, ui.groups.syncIncomplete, true);
          return;
        }
      }
      if (suffix === '/goal/add') {
        const rejected = (out.results || []).filter(
          (item: any) => !['added', 'already in library'].includes(item.status),
        );
        if (rejected.length) {
          if (current(version) && selected === id) {
            await refresh();
            if (current(version) && selected === id)
              message(
                key,
                ui.groups.goalRejected(rejected.length, rejected[0].reason || ui.groups.retry),
                true,
              );
          }
          return;
        }
      }
      if (!current(version) || (!options.forget && selected !== id)) return;
      await refresh();
      if (current(version) && (options.forget || selected === id))
        message(key, suffix === '/pray' && out.alreadySent ? ui.groups.prayerAlreadySent : success);
    } catch (error) {
      if (current(version) && selected === id) message(key, errorText(error), true);
    } finally {
      if (current(version)) busy = '';
    }
  }
  async function weekly(enabled: boolean) {
    if (!group || busy) return;
    cancelReads();
    const version = epoch,
      id = group.id,
      old = group.weeklyPush;
    group = { ...group, weeklyPush: enabled };
    busy = 'weekly';
    clearNote('weekly');
    try {
      await api(path(id, '/weekly'), { enabled });
      if (current(version) && group?.id === id) await refresh();
      if (current(version) && group?.id === id)
        message('weekly', enabled ? ui.groups.weeklyOn : ui.groups.weeklyOff);
    } catch (error) {
      if (current(version) && group?.id === id) {
        group = { ...group, weeklyPush: old };
        message('weekly', errorText(error), true);
      }
    } finally {
      if (current(version)) busy = '';
    }
  }
  async function copyInvite() {
    if (!invite) return;
    const version = epoch,
      id = selected,
      request = ++copyRequest,
      link = invite.url;
    clearNote('copy');
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(new URL(link, location.origin).href);
      if (current(version) && selected === id && request === copyRequest)
        message('copy', ui.groups.inviteCopied);
    } catch {
      if (current(version) && selected === id && request === copyRequest) {
        inviteInput?.focus({ preventScroll: true });
        inviteInput?.select();
        message('copy', ui.groups.inviteCopyFallback, false, true);
      }
    }
  }
  function confirmAction() {
    if (!confirmation || confirmation.done || !group) return;
    const { kind, member } = confirmation;
    if (kind === 'delete')
      void mutate('confirm', '', undefined, ui.groups.deleted, { method: 'DELETE', forget: true });
    else if (kind === 'leave')
      void mutate('confirm', '/leave', {}, ui.groups.left, { forget: true });
    else if (kind === 'remove' && member)
      void mutate('confirm', '/remove', { memberId: member.id }, ui.groups.memberRemoved);
    else if (kind === 'transfer' && member)
      void mutate('confirm', '/transfer', { memberId: member.id }, ui.groups.ownershipTransferred);
  }
  const confirmationTitle = $derived(
    confirmation?.kind === 'delete'
      ? ui.groups.deleteTitle
      : confirmation?.kind === 'leave'
        ? ui.groups.leaveTitle
        : confirmation?.kind === 'transfer'
          ? ui.groups.transferTitle
          : ui.groups.removeTitle,
  );
</script>

{#snippet feedback(key: string)}
  <p
    use:revealFeedback={notes[key]}
    class="feedback"
    class:sr-only={!notes[key]}
    class:failed={notes[key]?.error}
    aria-live="polite"
    aria-atomic="true"
    role={notes[key] ? (notes[key].error ? 'alert' : 'status') : undefined}
  >
    {notes[key]?.text || ''}
  </p>
{/snippet}

<section class="groups-panel" aria-label={ui.groups.heading} bind:this={panel}>
  {#if visible}{@render feedback('list')}{/if}
  {#if !account || (visible && listed && !groups.length && !notes.list)}<div
      class="groups-empty stack"
    >
      <svg viewBox="0 0 48 48" aria-hidden="true"
        ><circle cx="24" cy="24" r="21" /><circle cx="24" cy="17" r="6" /><path
          d="M12 38v-3a12 12 0 0 1 24 0v3"
        /></svg
      >
      <h2>{ui.groups.empty}</h2>
      <div class="stack">
        <button onclick={() => void openForms('create')}>{ui.groups.createHeading}</button><button
          class="secondary"
          onclick={() => void openForms('join')}>{ui.groups.joinWithCode}</button
        >
      </div>
    </div>{:else}<p class="intro">{ui.groups.intro}</p>{/if}
  {#if !account}
    <p>{pendingCode ? ui.groups.signInInvite : ui.groups.signInHelp}</p>
    {#if pendingCode}<button class="secondary" onclick={() => onSignIn()}>{ui.groups.signIn}</button
      >{/if}
  {:else if visible}
    {#if loading && !listed}<p class="group-loading" role="status">{ui.groups.loadingList}</p>{/if}
    {#if groups.length}
      <nav class="group-list" aria-label={ui.groups.listLabel}>
        {#each groups as item (item.id)}
          <button
            class="group-choice secondary"
            class:chosen={selected === item.id}
            aria-pressed={selected === item.id}
            disabled={!!busy}
            onclick={() => choose(item.id)}
            ><strong>{item.name}</strong>{#if item.pending?.length}<span
                class="translation-badge"
                aria-label={ui.groups.pendingCount(item.pending.length)}>{item.pending.length}</span
              >{/if}<small>{ui.groups.choiceSummary(item.memberCount, item.role)}</small></button
          >
        {/each}
      </nav>
    {/if}
    {@render feedback('detail')}
    {#if detailLoading && !group}<p role="status">{ui.groups.loadingDetail}</p>{/if}
    {#if pendingMemberships.length}<section class="panel stack" aria-label={ui.groups.yourRequests}>
        <h3>{ui.groups.yourRequests}</h3>
        {#each pendingMemberships as item (item.id)}<div class="stack">
            <strong>{item.name}</strong><small>{ui.groups.awaitingApproval(item.ownerName)}</small
            ><button class="text-button" disabled={!!busy} onclick={() => void withdraw(item.id)}
              >{busy === 'withdraw:' + item.id ? ui.groups.withdrawing : ui.groups.withdraw}</button
            >{@render feedback('withdraw:' + item.id)}
          </div>{/each}
      </section>{/if}
    {#each Object.keys(notes).filter((key) => key.startsWith('withdraw:') && !pendingMemberships.some((item) => key === 'withdraw:' + item.id)) as key (key)}{@render feedback(
        key,
      )}{/each}
    {#if formsOpen || groups.length || pendingMemberships.length}<details
        class="panel"
        bind:open={formsOpen}
      >
        <summary>{ui.groups.createOrJoin}</summary>
        <div class="forms">
          <form
            class="stack"
            onsubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <h3>{ui.groups.createHeading}</h3>
            <label
              >{ui.groups.name}<input
                bind:this={nameInput}
                bind:value={name}
                maxlength="80"
                required
                autocomplete="off"
              /></label
            >
            <label class="check"
              ><input type="checkbox" bind:checked={approval} />{ui.groups.approveNew}</label
            >
            <button type="submit" disabled={!!busy || !name.trim()}
              >{busy === 'create' ? ui.groups.creating : ui.groups.create}</button
            >
            {@render feedback('create')}
          </form>
          <form
            class="stack"
            onsubmit={(event) => {
              event.preventDefault();
              void join();
            }}
          >
            <h3>{ui.groups.joinHeading}</h3>
            <label
              >{ui.groups.inviteCode}<input
                bind:this={codeInput}
                bind:value={code}
                required
                maxlength="64"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                placeholder={ui.groups.invitePlaceholder}
              /></label
            >
            <button type="submit" disabled={!!busy || !code.trim()}
              >{busy === 'join' ? ui.groups.joining : ui.groups.join}</button
            >
            {@render feedback('join')}
          </form>
        </div>
      </details>{/if}
    {#if group}
      <article class="panel stack" aria-label={group.name} aria-busy={loading || detailLoading}>
        <header>
          <h3 class="group-name">{group.name}</h3>
          <small>{ui.groups.memberSummary(group.memberCount, group.role)}</small>
        </header>
        <section class="stack goal" aria-label={ui.groups.goalHeading}>
          <h3>{ui.groups.goalHeading}</h3>
          {#if group.goal}
            <strong>{group.goal.title}</strong>
            <small
              >{ui.groups.goalSummary(
                group.goal.selection.kind === 'passage' ||
                  group.goal.selection.kind === 'topic' ||
                  (group.goal.selection.kind === 'starter' &&
                    ['gospel', 'psalm23'].includes(group.goal.selection.id || ''))
                  ? group.goal.selection.translation
                  : undefined,
                group.goal.total,
              )}</small
            >
            {@const self = group.members.find((member) => member.self)}
            {#if self}<p>{ui.groups.goalLearnedByYou(self.goalLearned, self.goalTotal)}</p>{/if}
            <button
              disabled={!!busy}
              onclick={() =>
                void mutate('goal', '/goal/add', {}, ui.groups.goalAdded, { sync: true })}
              >{busy === 'goal' ? ui.groups.adding : ui.groups.addGoal}</button
            >
            {@render feedback('goal')}
          {:else}<p>{ui.groups.noGoal}</p>{/if}
          {#if manager}<button
              class="text-button"
              disabled={!!busy}
              onclick={() => onChooseGoal(group!.id)}>{ui.groups.chooseGoal}</button
            >{/if}
        </section>
        <section class="stack" aria-label={ui.groups.membersLabel}>
          <h3>{ui.groups.membersHeading}</h3>
          <ul class="members">
            {#each group.members as member (member.id)}
              <li class="member">
                <div class="member-heading">
                  <strong>{ui.groups.memberName(member.name, member.self)}</strong><small
                    >{ui.groups.roles[member.role]}</small
                  >
                </div>
                <WeekDots days={weekDotDays(member.weekDays)} />
                <p class="metrics">
                  {ui.groups.weekPracticed(new Set(member.weekDays).size, member.weeklyGoal)}<br
                  />{ui.groups.learnedAndStreak(member.learnedCount, member.streak)}
                </p>
                {#if group.goal}<p class="metrics">
                    {ui.groups.goalProgress(
                      member.goalStatus,
                      member.goalLearned,
                      member.goalTotal,
                    )}
                  </p>{/if}
                {#if member.titles?.length && (!member.self || (settings as Settings & { groupShareTitles?: boolean }).groupShareTitles !== false)}
                  <details class="titles">
                    <summary>{ui.groups.titles}</summary>
                    <ul>
                      {#each member.titles as title, index (`${index}:${title.title}:${title.translation}`)}<li
                        >
                          <span>{title.title}</span>{#if title.translation}<small
                              class="translation">{title.translation}</small
                            >{/if}<small
                            >{title.learned ? ui.groups.learned : ui.groups.memorizing}</small
                          >
                        </li>{/each}
                    </ul>
                  </details>
                {/if}
                {#if !member.self}
                  <button
                    class="text-button"
                    disabled={!!busy}
                    aria-label={ui.groups.prayFor(member.name)}
                    onclick={() =>
                      void mutate(
                        `pray:${member.id}`,
                        '/pray',
                        { memberId: member.id },
                        ui.groups.prayerSent,
                      )}>{busy === `pray:${member.id}` ? ui.groups.sending : ui.groups.pray}</button
                  >
                  {@render feedback(`pray:${member.id}`)}
                  {#if manager && member.role !== 'owner' && (owner || member.role === 'member')}
                    <details class="member-controls">
                      <summary>{ui.groups.manageMember(member.name)}</summary>
                      <div class="stack">
                        {#if owner}<label
                            >{ui.groups.roleFor(member.name)}<select
                              value={member.role}
                              disabled={!!busy}
                              onchange={(event) => {
                                const role = event.currentTarget.value;
                                event.currentTarget.value = member.role;
                                void mutate(
                                  `role:${member.id}`,
                                  '/role',
                                  { memberId: member.id, role },
                                  ui.groups.roleUpdated,
                                );
                              }}
                              ><option value="member">{ui.groups.memberRole}</option><option
                                value="admin">{ui.groups.adminRole}</option
                              ></select
                            ></label
                          >{@render feedback(`role:${member.id}`)}{/if}
                        <button
                          class="text-button danger"
                          disabled={!!busy}
                          onclick={() => {
                            clearNote('confirm');
                            confirmation = { kind: 'remove', member, groupName: group!.name };
                          }}>{ui.groups.removeMember}</button
                        >
                        {#if owner}<button
                            class="text-button"
                            disabled={!!busy}
                            onclick={() => {
                              clearNote('confirm');
                              confirmation = { kind: 'transfer', member, groupName: group!.name };
                            }}>{ui.groups.transferTo(member.name)}</button
                          >{/if}
                      </div>
                    </details>
                  {/if}
                {/if}
              </li>
            {/each}
          </ul>
        </section>
        <section class="stack" aria-label={ui.groups.notificationsLabel}>
          <label class="check"
            ><input
              type="checkbox"
              checked={group.weeklyPush !== false}
              disabled={!!busy}
              onchange={(event) => void weekly(event.currentTarget.checked)}
            />{ui.groups.weeklySummary}</label
          >
          <small>{ui.groups.weeklyHelp}</small>{@render feedback('weekly')}
        </section>
        {#if manager}
          <details class="management">
            <summary>{ui.groups.manage}</summary>
            <div class="stack">
              {#if owner}
                <label class="check"
                  ><input
                    type="checkbox"
                    checked={group.approveNewMembers}
                    disabled={!!busy}
                    onchange={(event) => {
                      const approveNewMembers = event.currentTarget.checked;
                      event.currentTarget.checked = group!.approveNewMembers;
                      void mutate(
                        'approval',
                        '/update',
                        { approveNewMembers },
                        ui.groups.approvalSaved,
                      );
                    }}
                  />{ui.groups.approveNew}</label
                >{@render feedback('approval')}
              {/if}
              {#if pendingRows.length}
                <section class="stack" aria-label={ui.groups.pendingLabel}>
                  <h3>{ui.groups.pendingHeading}</h3>
                  {#each pendingRows as pending (pending.id)}<div class="pending stack">
                      <strong>{pending.name}</strong
                      >{#if group.pending?.some((member) => member.id === pending.id)}<div
                          class="actions"
                        >
                          <button
                            class="secondary"
                            disabled={!!busy}
                            aria-label={ui.groups.approveMember(pending.name)}
                            onclick={() =>
                              void mutate(
                                `pending:${pending.id}`,
                                '/approve',
                                { memberId: pending.id },
                                ui.groups.memberApproved,
                              )}>{ui.groups.approve}</button
                          ><button
                            class="text-button"
                            disabled={!!busy}
                            aria-label={ui.groups.declineMember(pending.name)}
                            onclick={() =>
                              void mutate(
                                `pending:${pending.id}`,
                                '/remove',
                                { memberId: pending.id },
                                ui.groups.requestDeclined,
                              )}>{ui.groups.decline}</button
                          >
                        </div>{/if}{@render feedback(`pending:${pending.id}`)}
                    </div>{/each}
                </section>
              {/if}
              <form
                class="stack"
                onsubmit={(event) => {
                  event.preventDefault();
                  void mutate('invite', '/invite', { expiresDays, maxUses }, ui.groups.inviteReady);
                }}
              >
                <h3>{ui.groups.inviteHeading}</h3>
                <label
                  >{ui.groups.inviteDays}<input
                    type="number"
                    min="1"
                    max="90"
                    step="1"
                    required
                    bind:value={expiresDays}
                  /></label
                >
                <label
                  >{ui.groups.inviteUses}<input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    required
                    bind:value={maxUses}
                  /></label
                >
                <button type="submit" disabled={!!busy}
                  >{busy === 'invite' ? ui.groups.generating : ui.groups.generateInvite}</button
                >
                {@render feedback('invite')}
              </form>
              {#if invite}
                <div class="stack invite">
                  <label
                    >{ui.groups.inviteLink}<input
                      bind:this={inviteInput}
                      readonly
                      value={new URL(invite.url, location.origin).href}
                      onclick={(event) => event.currentTarget.select()}
                    /></label
                  >
                  <label
                    >{ui.groups.inviteCode}<input
                      readonly
                      value={invite.code
                        .replace(/-/g, '')
                        .match(/.{1,4}/g)
                        ?.join('-') || invite.code}
                      onclick={(event) => event.currentTarget.select()}
                    /></label
                  >
                  <small>{ui.groups.inviteExpiry(invite.expiresAt, invite.maxUses)}</small>
                  <button class="secondary" type="button" onclick={() => void copyInvite()}
                    >{ui.groups.copyInvite}</button
                  >{@render feedback('copy')}
                </div>
              {/if}
              <small>{ui.groups.inviteHelp}</small>
              <button
                class="text-button"
                disabled={!!busy}
                onclick={() => void mutate('revoke', '/invite/revoke', {}, ui.groups.inviteRevoked)}
                >{ui.groups.revokeInvite}</button
              >{@render feedback('revoke')}
            </div>
          </details>
        {/if}
        <footer class="stack">
          <p class="privacy">{ui.groups.privacy(settings.groupShareTitles !== false)}</p>
          {#if owner}<small>{ui.groups.ownerLeaveHelp}</small><button
              class="text-button danger"
              disabled={!!busy}
              onclick={() => {
                clearNote('confirm');
                confirmation = { kind: 'delete', groupName: group!.name };
              }}>{ui.groups.delete}</button
            >
          {:else}<button
              class="text-button"
              disabled={!!busy}
              onclick={() => {
                clearNote('confirm');
                confirmation = { kind: 'leave', groupName: group!.name };
              }}>{ui.groups.leave}</button
            >{/if}
        </footer>
      </article>
    {/if}
  {/if}
</section>

{#if visible && confirmation}
  <Sheet
    title={confirmationTitle}
    close={busy
      ? undefined
      : () => {
          confirmation = null;
        }}
  >
    <div class="group-confirmation stack">
      {#if confirmation.kind === 'delete'}<p>{ui.groups.deleteDetail(confirmation.groupName)}</p>
      {:else if confirmation.kind === 'leave'}<p>{ui.groups.leaveDetail(confirmation.groupName)}</p>
      {:else if confirmation.kind === 'transfer'}<p>
          {ui.groups.transferDetail(confirmation.member?.name || '', confirmation.groupName)}
        </p>
      {:else}<p>
          {ui.groups.removeDetail(confirmation.member?.name || '', confirmation.groupName)}
        </p>{/if}
      <button disabled={!!busy || confirmation.done} onclick={confirmAction}
        >{busy === 'confirm'
          ? ui.groups.saving
          : confirmation.kind === 'delete'
            ? ui.groups.delete
            : confirmation.kind === 'leave'
              ? ui.groups.leave
              : confirmation.kind === 'transfer'
                ? ui.groups.transfer
                : ui.groups.removeMember}</button
      >
      {@render feedback('confirm')}
      <button
        class="secondary"
        disabled={!!busy}
        onclick={() => {
          confirmation = null;
        }}>{confirmation.done ? ui.closeDialog : ui.groups.cancel}</button
      >
    </div>
  </Sheet>
{/if}
