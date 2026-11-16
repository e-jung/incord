<script lang="ts">
  import { hapticOverlay } from './haptic-overlay';
  import ActionFeedback from './components/ActionFeedback.svelte';

  import Groups from './components/Groups.svelte';

  import { incordCopy as incord } from './config/incord';

  import { copy as ui, plural, practiceCount, minutes, sourceLabel } from './config/copy';

  import ProgressPie from './components/ProgressPie.svelte';

  import Button from './components/Button.svelte';
  import List from './components/List.svelte';
  import Row from './components/Row.svelte';
  import Cover from './components/Cover.svelte';

  import StepDots from './components/StepDots.svelte';
  import WeekDots from './components/WeekDots.svelte';
  import TabBar from './components/TabBar.svelte';
  import Keyboard from './components/Keyboard.svelte';
  import VerseText from './components/VerseText.svelte';

  import { starters } from './content';

  import { addItems, today } from './store';

  import AccountScreen from './screens/AccountScreen.svelte';
  import DiscoverScreen from './screens/DiscoverScreen.svelte';
  import PracticeScreen from './screens/PracticeScreen.svelte';
  import AppDialogs from './screens/AppDialogs.svelte';
  import { createAppState } from './controllers/state.svelte';
  import { installAppLifecycle } from './controllers/lifecycle.svelte';
  const vm = createAppState();
  installAppLifecycle(vm);
</script>

{#if vm.printableCode}<article class="signin-print-card">
    <h1>{ui.codeAccount.printTitle}</h1>
    <p class="signin-code-value">{vm.printableCode}</p>
    <p>{ui.codeAccount.printHelp}</p>
    <p>{location.host}</p>
  </article>{/if}
<svelte:window onkeydown={vm.physical} />
<main
  use:hapticOverlay={{ enabled: !!vm.data.settings.haptics }}
  class:practicing={!!vm.practice && !vm.learned}
>
  {#if !vm.ready}<section class="empty">
      <h1>{ui.appName}</h1>
      <p>{ui.loadingBody}</p>
    </section>
  {:else if vm.oauthRoute && vm.identityVerified && vm.account}
    <section class="page mcp-consent stack" aria-labelledby="consent-title">
      <small>{ui.appName}</small>
      <h1 id="consent-title">{ui.mcpConsentTitle}</h1>
      {#if vm.consent}
        <p>{ui.mcpConsentIntro(vm.consent.clientName)}</p>
        <section class="settings-group">
          <h2 class="mcp-client-name">{vm.consent.clientName}</h2>
          {#if vm.consent.clientDomain}<small>{vm.consent.clientDomain}</small>{/if}
          <p>{ui.mcpUnverified}</p>
          <h3>{ui.mcpPermissions}</h3>
          <ul class="mcp-scopes">
            {#each vm.consent.scope as scope}<li>{ui.mcpScope(scope)}</li>{/each}
          </ul>
          <p>{ui.mcpRedirect(vm.consent.redirectHost)}</p>
          {#if vm.consent.redirectIsLoopback}<p class="notice">{ui.mcpLoopback}</p>{/if}
        </section>
        <p>{ui.mcpRevokeHint}</p>
        <form
          class="stack"
          onsubmit={(event) => {
            event.preventDefault();
            void vm.decideConsent('approve');
          }}
          aria-label={ui.mcpApprove}
        >
          <Button type="submit" disabled={vm.consentBusy}
            >{vm.consentBusy ? ui.mcpWorking : ui.mcpApprove}</Button
          ><ActionFeedback
            note={vm.consentDecision === 'approve' && vm.consentError
              ? { text: vm.consentError, error: true }
              : undefined}
          />
        </form>
        <form
          onsubmit={(event) => {
            event.preventDefault();
            void vm.decideConsent('deny');
          }}
          aria-label={ui.mcpDeny}
        >
          <Button secondary type="submit" disabled={vm.consentBusy}>{ui.mcpDeny}</Button
          ><ActionFeedback
            note={vm.consentDecision === 'deny' && vm.consentError
              ? { text: vm.consentError, error: true }
              : undefined}
          />
        </form>
      {:else if vm.consentBusy}<p role="status">{ui.mcpLoadingConsent}</p>{/if}
      {#if vm.consentError && !vm.consentDecision}<p class="notice error" role="alert">
          {vm.consentError}
        </p>
        {#if !vm.consent}<Button
            secondary
            disabled={vm.consentBusy}
            onclick={() => void vm.loadConsent()}>{ui.mcpRetry}</Button
          >{/if}{/if}
    </section>
  {:else if vm.practice}
    <PracticeScreen {vm} />
  {:else}
    <section class="page" class:has-toast={!!vm.undoItem} class:account={vm.tab === ui.account}>
      <header class:collection-header={!!vm.detail}>
        {#if !vm.detail}<div>
            <h1>
              {vm.tab === ui.account
                ? ui.accountTitle
                : vm.tab === ui.gallery
                  ? ui.components
                  : vm.tab}
            </h1>
            {#if vm.tab === ui.today}<p>
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>{/if}
          </div>{/if}<button
          class="icon"
          aria-label={vm.detail ? ui.backToLibrary : ui.accountSettings}
          onclick={() => (vm.detail ? vm.openCollection('') : vm.navigate(ui.account))}
          >{#if vm.detail}{ui.backGlyph}{:else if vm.data.settings.name.trim()}{vm.data.settings.name
              .trim()
              .slice(0, 1)
              .toUpperCase()}{:else}<svg class="person" viewBox="0 0 24 24" aria-hidden="true"
              ><circle cx="12" cy="8" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3" /></svg
            >{/if}</button
        >
      </header>
      {#if vm.loadingPassage && vm.tab !== ui.discover}<p role="status">
          {ui.loadingBody}
        </p>{/if}{#if vm.error}<div class="notice error" role="alert">
          {vm.error}
        </div>{/if}{#if vm.message}<div class="notice" role="status">{vm.message}</div>{/if}
      {#if vm.tab === ui.today}
        <div class="rhythm">
          <div><b>{vm.weekCount}{ui.of}{vm.data.settings.goal}{ui.thisWeekSuffix}</b></div>
          <WeekDots days={vm.data.settings.days} />
        </div>
        {#if vm.due.length}<div class="hero">
            <div>
              <b>{practiceCount(vm.due.length)}</b><small>{minutes(vm.estimatedMinutes)}</small>
            </div>
            <Button onclick={() => vm.begin(vm.due)}>{ui.begin}</Button>
          </div>
          <h3 class="section-title">{ui.forToday}</h3>
          <List
            >{#each vm.due as item}<Row
                title={item.title}
                translation={item.translation}
                subtitle={`${item.learned ? ui.review : item.step === 1 ? ui.new : ui.learningStep(item.step)}${item.translation ? ui.empty : ` · ${sourceLabel(item)}`}`}
                onclick={() => vm.begin([item])}
                ><StepDots step={item.learned ? 5 : item.step} /></Row
              ><ActionFeedback note={vm.actionNotes['practice-load-' + item.id]} />{/each}</List
          >
        {:else}<div class="empty">
            <div class="heart">♡</div>
            <h2>{vm.live.length ? ui.doneForToday : ui.noItemsYet}</h2>
            {#if !vm.live.length}<p>{ui.addCollection}</p>{/if}<Button
              onclick={() => vm.navigate(vm.live.length ? ui.library : ui.discover)}
              >{vm.live.length ? ui.visitLibrary : ui.findSomething}</Button
            >
          </div>{/if}
        {#if vm.groupAttention && (vm.groupAttention.pendingRequests || vm.prayerAttention || vm.groupAttention.goalsNearlyDone)}<button
            class="text-button group-attention"
            aria-labelledby="group-attention-text"
            onclick={vm.openGroupAttention}
            ><span aria-hidden="true"
              >{vm.groupAttention.pendingRequests ? '◌' : vm.prayerAttention ? '♡' : '◉'}</span
            ><span id="group-attention-text"
              >{vm.groupAttention.pendingRequests
                ? ui.groups.attentionPending(vm.groupAttention.pendingRequests)
                : vm.prayerAttention
                  ? ui.groups.attentionPrayer
                  : ui.groups.attentionGoal}</span
            ><span aria-hidden="true">›</span></button
          >{/if}
      {:else if vm.tab === ui.groups.heading}
        {#key vm.account?.id || 'signed-out'}<Groups
            account={vm.identityVerified ? vm.account : null}
            settings={vm.data.settings}
            onSync={vm.sync}
            onChooseGoal={vm.chooseGroupGoal}
            onSignIn={vm.signInForGroups}
            pendingCode={vm.pendingGroupCode}
            onJoined={vm.joinedGroup}
            initialGroupId={vm.initialGroupId}
            onSelect={(id) => (vm.initialGroupId = id)}
            onAttention={vm.setGroupAttention}
            onDialogChange={(close) => (vm.groupDialogClose = close)}
          />{/key}
      {:else if vm.tab === ui.library}
        {#if vm.detail}<Cover
            title={vm.collectionTitle(vm.detail)}
            subtitle={plural(vm.detailItems.length, 'item')}
            color={starters.findIndex((s: any) => s.id === vm.detail)}
            compact
          />
          <div class="section-title">
            <h3>{ui.yourItems}</h3>
            <button
              class="text-button"
              onclick={() => {
                const target = vm.detail;
                vm.openDiscoverAdd();
                vm.addTarget = target;
              }}>{ui.addItems}</button
            >
          </div>
          <List
            >{#each vm.detailItems as item}<Row
                title={item.title}
                subtitle={item.learned ? ui.reviewDate(item.due) : ui.stepPrefix + item.step}
                translation={item.translation}
                onclick={() => vm.begin([item])}
                ><StepDots step={item.learned ? 5 : item.step} />{#snippet trailing()}<button
                    class="text-button item-menu"
                    aria-label={ui.optionsPrefix + item.title}
                    onclick={() => {
                      vm.clearAction('remove');
                      vm.removeTarget = item;
                    }}>…</button
                  >{/snippet}</Row
              ><ActionFeedback
                note={vm.actionNotes['practice-load-' + item.id]}
              />{#if !item.learned && !vm.due.some((i) => i.id === item.id)}<button
                  class="text-button"
                  onclick={() => vm.begin([item])}>{ui.startEarly}</button
                >{/if}{/each}</List
          >{#if vm.detailItems.length}<div class="collection-practice">
              <Button onclick={() => vm.begin(vm.detailItems)}>{ui.startPractice}</Button>
            </div>{:else}<p>{ui.nothingHere}</p>{/if}
        {:else}<div class="section-title">
            <h3>{ui.yours}</h3>
            <button class="text-button" onclick={vm.openDiscoverAdd}>{ui.addShortcut}</button>
          </div>
          <List
            >{#each [...new Set(vm.live.map((i) => i.collection))] as id}{@const items =
                vm.live.filter((i) => i.collection === id)}<Row
                title={vm.collectionTitle(id)}
                subtitle={items.filter((i) => i.learned).length +
                  ui.of +
                  items.length +
                  ui.learnedSuffix}
                onclick={() => vm.openCollection(id)}
                ><ProgressPie
                  percent={(items.filter((i) => i.learned).length / items.length) * 100}
                /></Row
              >{/each}</List
          >{#if !vm.live.length}<div class="library-empty">
              <p>{ui.libraryEmpty}</p>
              <Button onclick={() => vm.navigate(ui.discover)}>{ui.findSomething}</Button>
            </div>{/if}{/if}
      {:else if vm.tab === ui.discover}
        <DiscoverScreen {vm} />
      {:else if vm.tab === ui.account}
        <AccountScreen {vm} />
      {:else if vm.tab === ui.gallery}<div class="gallery">
          <Button>{ui.primaryButton}</Button><Button secondary>{ui.secondaryButton}</Button
          ><StepDots step={3} /><WeekDots days={vm.data.settings.days} /><Cover
            title={ui.gospelTitle}
            subtitle={ui.galleryVerseCount}
            color={0}
            large
          /><Row title={ui.johnReference} subtitle={ui.galleryStep} translation={ui.bsb}
            ><StepDots step={2} /></Row
          ><VerseText
            words={[
              ui.sampleFor,
              ui.sampleGod,
              ui.sampleSo,
              ui.sampleLoved,
              ui.sampleThe,
              ui.sampleWorld,
            ]}
            mask={[false, true, false, true, true, false]}
            index={2}
          /><Keyboard onkey={() => {}} />
        </div>{/if}
    </section>
    <TabBar
      active={vm.tab}
      onchange={vm.navigate}
      pendingRequests={vm.groupAttention?.pendingRequests || 0}
    />
  {/if}
  <AppDialogs {vm} />
</main>
