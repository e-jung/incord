<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import type { Account, Settings } from '../store';
  import { copy as ui } from '../config/copy';
  import Button from './Button.svelte';

  type Intent =
    { kind: 'create'; name: string; approval: boolean } | { kind: 'join'; code: string };
  let {
    account,
    settings,
    pendingCode,
    busy,
    hasMemberships,
    onSaveName,
    onCreate,
    onJoin,
    feedback,
  }: {
    account: Account;
    settings: Settings;
    pendingCode: string;
    busy: string;
    hasMemberships: boolean;
    onSaveName: (name: string) => Promise<void>;
    onCreate: (name: string, approval: boolean) => Promise<boolean | undefined>;
    onJoin: (code: string) => Promise<boolean | 'pending' | undefined>;
    feedback: Snippet<[string]>;
  } = $props();
  let formsOpen = $state(false),
    name = $state(''),
    code = $state(''),
    approval = $state(false);
  let intent = $state<Intent | null>(null),
    yourName = $state(''),
    savingName = $state(false),
    error = $state('');
  let nameInput = $state<HTMLInputElement>(),
    codeInput = $state<HTMLInputElement>(),
    personInput = $state<HTMLInputElement>();
  let attemptedInvite = '';
  const disabled = $derived(!!busy || savingName);

  export async function open(mode: 'create' | 'join') {
    formsOpen = true;
    await tick();
    (mode === 'create' ? nameInput : codeInput)?.focus();
  }
  async function execute(next: Intent) {
    if (next.kind === 'create') {
      if (await onCreate(next.name, next.approval)) name = '';
    } else {
      const result = await onJoin(next.code);
      if (result) code = '';
      if (result === 'pending') formsOpen = false;
    }
  }
  async function request(next: Intent) {
    if (disabled) return;
    if (!settings.name.trim()) {
      intent = next;
      // Legacy Google profiles can supply a name; email/Accounts return only "Friend".
      const profileName = account.displayName?.trim();
      yourName = profileName && profileName !== 'Friend' ? profileName : '';
      error = '';
      await tick();
      personInput?.focus();
      return;
    }
    await execute(next);
  }
  async function saveName() {
    if (!intent || !yourName.trim() || disabled) return;
    const next = intent;
    savingName = true;
    error = '';
    try {
      // The normal settings save stamps the name's field clock and finishes sync first.
      await onSaveName(yourName.trim());
      intent = null;
      await execute(next);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : ui.groups.nameSaveFailed;
    } finally {
      savingName = false;
    }
  }
  $effect(() => {
    const pending = pendingCode,
      running = busy;
    untrack(() => {
      if (!pending || running || attemptedInvite === pending) return;
      attemptedInvite = pending;
      formsOpen = true;
      code = pending;
      void request({ kind: 'join', code: pending });
    });
  });
</script>

{#if intent}
  <form
    class="panel stack"
    aria-label={ui.groups.namePrompt}
    onsubmit={(event) => {
      event.preventDefault();
      void saveName();
    }}
  >
    <h3>{intent.kind === 'join' ? ui.groups.joinHeading : ui.groups.createHeading}</h3>
    <p>{ui.groups.nameHelp}</p>
    <label
      >{ui.groups.yourName}<input
        bind:this={personInput}
        bind:value={yourName}
        required
        maxlength="80"
        autocomplete="name"
      /></label
    >
    <Button type="submit" disabled={disabled || !yourName.trim()}
      >{savingName ? ui.groups.saving : ui.groups.saveNameContinue}</Button
    >
    {#if error}<p class="feedback failed" role="alert">{error}</p>{/if}
  </form>
{:else if formsOpen || hasMemberships}
  <details class="panel" bind:open={formsOpen}>
    <summary>{ui.groups.createOrJoin}</summary>
    <div class="forms">
      <form
        class="stack"
        onsubmit={(event) => {
          event.preventDefault();
          void request({ kind: 'create', name: name.trim(), approval });
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
        <Button type="submit" disabled={disabled || !name.trim()}
          >{busy === 'create' ? ui.groups.creating : ui.groups.create}</Button
        >
        {@render feedback('create')}
      </form>
      <form
        class="stack"
        onsubmit={(event) => {
          event.preventDefault();
          void request({ kind: 'join', code: code.trim() });
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
        <Button type="submit" disabled={disabled || !code.trim()}
          >{busy === 'join' ? ui.groups.joining : ui.groups.join}</Button
        >
        {@render feedback('join')}
      </form>
    </div>
  </details>
{/if}
