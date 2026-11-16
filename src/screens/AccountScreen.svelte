<script lang="ts">
  import ActionFeedback from '../components/ActionFeedback.svelte';

  import { supportUrl } from '../../shared/support';
  import { incordCopy as incord } from '../config/incord';
  import EsvAttribution from '../components/EsvAttribution.svelte';
  import * as stats from '../stats';
  import { appVersion } from '../telemetry';

  import { copy as ui } from '../config/copy';

  import { RULES } from '../config/rules';
  import Button from '../components/Button.svelte';

  import { passageTranslations } from '../passages';

  import type { AppRuntime } from '../controllers/state.svelte';
  import EmailForm from './EmailForm.svelte';
  import SignInCodeControls from './SignInCodeControls.svelte';
  let {
    vm,
  }: {
    vm: Pick<
      AppRuntime,
      | 'pendingGroupCode'
      | 'account'
      | 'oauthRoute'
      | 'consentError'
      | 'mergePrompt'
      | 'mergeDismissed'
      | 'config'
      | 'emailOpen'
      | 'editEmail'
      | 'emailStatus'
      | 'googleSignin'
      | 'googleLinkError'
      | 'online'
      | 'clearAction'
      | 'confirmSignout'
      | 'confirmEverywhere'
      | 'emailBusy'
      | 'codeBusy'
      | 'jlBusy'
      | 'primarySignin'
      | 'jlError'
      | 'actionNotes'
      | 'appsLoading'
      | 'connectedApps'
      | 'revokedApps'
      | 'appsError'
      | 'revoking'
      | 'revokeApp'
      | 'loadConnectedApps'
      | 'data'
      | 'savePreference'
      | 'changeTranslation'
      | 'feedback'
      | 'noteAction'
      | 'hapticsSupported'
      | 'zoneSearch'
      | 'zones'
      | 'pushState'
      | 'disablePush'
      | 'enablePush'
      | 'testPush'
      | 'deliveries'
      | 'shareCounts'
      | 'privacySignal'
      | 'setShareCounts'
      | 'exportData'
      | 'confirmDelete'
      | 'sendFeedback'
      | 'feedbackKind'
      | 'feedbackBusy'
      | 'feedbackMessage'
      | 'feedbackContact'
      | 'feedbackIncludeMeta'
      | 'feedbackError'
      | 'feedbackStatus'
      | 'feedbackResult'
      | 'emailError'
      | 'emailErrorControl'
      | 'emailSent'
      | 'verifyEmail'
      | 'sendEmail'
      | 'emailAddress'
      | 'emailCode'
      | 'codeInput'
      | 'resendSeconds'
      | 'deviceCode'
      | 'codeRevealed'
      | 'codeConfirm'
      | 'codeAccountAction'
      | 'codeReminder'
      | 'forgetCodeBackupReminder'
      | 'codeEntry'
      | 'copyAccountCode'
      | 'shareAccountCode'
      | 'printAccountCode'
    >;
  } = $props();
</script>

<div class="stack">
  {#if vm.pendingGroupCode && !vm.account}<section class="notice stack">
      <h2>{ui.groupInviteSignin}</h2>
      <p>{ui.groupInviteSigninHelp}</p>
    </section>{/if}{#if vm.oauthRoute}<section class="notice stack">
      <h2>{ui.mcpSigninTitle}</h2>
      <p>{ui.mcpSigninDetail}</p>
      {#if vm.consentError}<p role="alert">{vm.consentError}</p>{/if}
    </section>{/if}
  <section class="settings-group" aria-labelledby="account-heading">
    <h3 id="account-heading">{ui.yourAccount}</h3>
    {#if vm.account}<p>{ui.signedIn}</p>
      {#if vm.mergePrompt && vm.mergeDismissed}<Button
          secondary
          onclick={() => (vm.mergeDismissed = false)}>{ui.reviewDeviceItems}</Button
        >{/if}{#if vm.config.email && !vm.account.hasEmail}{#if !vm.emailOpen}<Button
            secondary
            onclick={() => {
              vm.emailOpen = true;
              vm.editEmail();
            }}>{ui.addEmail}</Button
          >{:else}<EmailForm {vm} />{/if}{/if}{#if vm.emailStatus && !vm.emailOpen}<p role="status">
          {vm.emailStatus}
        </p>{/if}{#if (vm.config.googleEnabled ?? vm.config.google) && !vm.account.hasGoogle}<Button
          secondary
          onclick={() => vm.googleSignin(true)}>{ui.codeAccount.addGoogle}</Button
        >{/if}{#if vm.googleLinkError}<p role="alert">
          {vm.googleLinkError}
        </p>{/if}<SignInCodeControls {vm} />{#if !vm.online}<small>{ui.offlineSync}</small
        >{/if}<Button
        secondary
        onclick={() => {
          vm.clearAction('signout');
          vm.confirmSignout = true;
        }}>{ui.signOut}</Button
      ><Button
        secondary
        onclick={() => {
          vm.clearAction('signout-everywhere');
          vm.confirmEverywhere = true;
        }}>{ui.signoutEverywhere}</Button
      >{:else}<p>{ui.localAccountNotice}</p>
      <Button disabled={!!vm.emailBusy || !!vm.codeBusy || vm.jlBusy} onclick={vm.primarySignin}
        >{ui.jesklabs.signIn}</Button
      >{#if vm.jlError}<p role="alert">
          {vm.jlError}
        </p>{/if}{#if vm.config.googleEnabled ?? vm.config.google}<Button
          disabled={!!vm.emailBusy || !!vm.codeBusy}
          onclick={() => vm.googleSignin()}>{ui.continueGoogle}</Button
        >{/if}{#if vm.config.email}<EmailForm {vm} />{/if}<SignInCodeControls
        {vm}
      />{/if}<ActionFeedback note={vm.actionNotes['signed-out']} />
  </section>
  <section class="settings-group" aria-labelledby="connected-apps-heading">
    <h3 id="connected-apps-heading">{ui.mcpConnectedApps}</h3>
    <p>{ui.mcpConnectedDetail}</p>
    <a href="/connect">{ui.mcpConnectGuide}</a>{#if vm.account}{#if vm.appsLoading}<p role="status">
          {ui.mcpLoadingApps}
        </p>{:else if !vm.connectedApps.some((app) => !vm.revokedApps.some((revoked) => revoked.id === app.id)) && !vm.appsError && !vm.revokedApps.some((app) => vm.actionNotes['revoke-' + app.id])}<p
        >
          {ui.mcpNoApps}
        </p>{/if}{#each vm.connectedApps as app (app.id)}<article
          class="mcp-app stack"
          class:revoked-app={vm.revokedApps.some((item) => item.id === app.id)}
        >
          {#if !vm.revokedApps.some((item) => item.id === app.id)}<h3>{app.clientName}</h3>
            <small>{ui.mcpConnectedDate(app.connectedAt)}</small><small
              >{app.lastUsed === null ? ui.mcpNeverUsed : ui.mcpLastUsed(app.lastUsed)}</small
            >
            <ul class="mcp-scopes">
              {#each app.scope as scope}<li>{ui.mcpScope(scope)}</li>{/each}
            </ul>
            <Button secondary disabled={!!vm.revoking} onclick={() => void vm.revokeApp(app)}
              >{vm.revoking === app.id ? ui.mcpRevoking : ui.mcpRevoke}</Button
            >{/if}<ActionFeedback note={vm.actionNotes['revoke-' + app.id]} />
        </article>{/each}{#if vm.appsError}<p role="alert">{vm.appsError}</p>
        <Button
          secondary
          disabled={vm.appsLoading || !!vm.revoking}
          onclick={() => void vm.loadConnectedApps()}>{ui.mcpRetry}</Button
        >{/if}{/if}
  </section>
  <section class="settings-group" aria-label={ui.preferences}>
    <label
      >{ui.displayName}<input
        bind:value={vm.data.settings.name}
        onchange={() => void vm.savePreference('name')}
        maxlength={80}
      /></label
    ><ActionFeedback note={vm.actionNotes.name} /><label
      >{ui.appearance}<select
        bind:value={vm.data.settings.theme}
        onchange={(event) => {
          vm.data.settings.theme = event.currentTarget.value;
          stats.trackStats(`theme:${vm.data.settings.theme}`);
          void vm.savePreference('theme');
        }}
        ><option value="system">{ui.system}</option><option value="light">{ui.light}</option><option
          value="dark">{ui.dark}</option
        ></select
      ></label
    ><ActionFeedback note={vm.actionNotes.theme} /><label
      >{ui.textSize}<select
        bind:value={vm.data.settings.textSize}
        onchange={(event) => {
          vm.data.settings.textSize = event.currentTarget.value;
          stats.trackStats(`text_size:${vm.data.settings.textSize}`);
          void vm.savePreference('textSize');
        }}
        >{#each ui.textSizes as [value, label]}<option {value}>{label}</option>{/each}</select
      ></label
    ><ActionFeedback note={vm.actionNotes.textSize} /><label
      >{ui.defaultTranslation}<select
        bind:value={vm.data.settings.defaultTranslation}
        onchange={vm.changeTranslation}
        >{#each passageTranslations as value}<option>{value}</option>{/each}</select
      ></label
    ><ActionFeedback note={vm.actionNotes.defaultTranslation} /><label
      >{ui.weeklyRhythm}<select
        bind:value={vm.data.settings.goal}
        onchange={() => void vm.savePreference('goal')}
        >{#each RULES.rhythmOptions as n}<option value={n}>{ui.weekOption(n)}</option
          >{/each}</select
      ></label
    ><ActionFeedback note={vm.actionNotes.goal} />
    <div class="feedback-setting">
      <div class="feedback-controls">
        <label class="toggle"
          ><input
            type="checkbox"
            bind:checked={vm.data.settings.keySounds}
            onchange={(event) => {
              vm.data.settings.keySounds = event.currentTarget.checked;
              void vm.savePreference('keySounds');
            }}
          />{ui.keySounds}</label
        ><span role="presentation" onpointerdown={() => vm.feedback.unlock({ keySounds: true })}
          ><button
            class="text-button"
            onclick={() => {
              vm.feedback.testSound();
              vm.noteAction('sound', ui.soundTestHelp);
            }}>{ui.testSound}</button
          ></span
        >
      </div>
      <small>{ui.soundHelp}</small><ActionFeedback note={vm.actionNotes.sound} /><ActionFeedback
        note={vm.actionNotes.keySounds}
      />
    </div>
    {#if vm.hapticsSupported}<div class="feedback-setting">
        <div class="feedback-controls">
          <label class="toggle"
            ><input
              type="checkbox"
              bind:checked={vm.data.settings.haptics}
              onchange={(event) => {
                vm.data.settings.haptics = event.currentTarget.checked;
                void vm.savePreference('haptics');
              }}
            />{ui.haptics}</label
          ><button
            class="text-button"
            disabled={!vm.data.settings.haptics}
            onclick={() => vm.noteAction('haptic', ui.hapticTestHelp)}>{ui.testHaptic}</button
          >
        </div>
        <small>{ui.hapticHelp}</small><ActionFeedback note={vm.actionNotes.haptic} /><ActionFeedback
          note={vm.actionNotes.haptics}
        />
      </div>{/if}<label
      >{ui.reminderTime}<input
        type="time"
        bind:value={vm.data.settings.reminderTime}
        onchange={() => void vm.savePreference('reminderTime')}
      /></label
    ><ActionFeedback note={vm.actionNotes.reminderTime} /><label
      >{ui.newPerDay}<select
        bind:value={(vm.data.settings as any).newPerDay}
        onchange={() => void vm.savePreference('newPerDay')}
        >{#each [1, 2, 3, 5] as n}<option value={n}>{n}</option>{/each}</select
      ></label
    ><ActionFeedback note={vm.actionNotes.newPerDay} /><label
      >{ui.searchZones}<input
        type="search"
        placeholder={ui.searchZones}
        bind:value={vm.zoneSearch}
      /></label
    ><label
      >{ui.timeZone}<select
        bind:value={vm.data.settings.timeZone}
        onchange={() => void vm.savePreference('timeZone')}
        >{#each vm.zones.filter((z) => z === vm.data.settings.timeZone || z
              .toLowerCase()
              .includes(vm.zoneSearch.toLowerCase())) as zone}<option>{zone}</option>{/each}</select
      ></label
    ><ActionFeedback note={vm.actionNotes.timeZone} />
    {#if vm.account}<label class="toggle"
        ><input
          type="checkbox"
          bind:checked={vm.data.settings.groupShareTitles}
          onchange={() => void vm.savePreference('groupShareTitles')}
        />{ui.groupShareTitles}</label
      ><ActionFeedback note={vm.actionNotes.groupShareTitles} /><small>{ui.groupShareHelp}</small
      ><label class="toggle"
        ><input
          type="checkbox"
          bind:checked={vm.data.settings.groupReceivePrayer}
          onchange={() => void vm.savePreference('groupReceivePrayer')}
        />{ui.groupReceivePrayer}</label
      ><ActionFeedback note={vm.actionNotes.groupReceivePrayer} /><small>{ui.groupPrayerHelp}</small
      >{/if}
  </section>
  <section class="settings-group" aria-labelledby="reminder-heading">
    <h3 id="reminder-heading">{ui.reminders}</h3>
    <p>{ui.reminderInstructions}</p>
    <p>
      {vm.pushState === 'on'
        ? ui.reminderOn
        : vm.pushState === 'missing'
          ? ui.reminderMissing
          : vm.pushState === 'denied'
            ? ui.reminderDenied
            : vm.pushState === 'unsupported'
              ? ui.iosInstallNotice
              : vm.pushState === 'unavailable'
                ? ui.deliveryUnavailable
                : ui.reminderOff}
    </p>
    <Button
      secondary
      disabled={vm.pushState === 'denied' || vm.pushState === 'unsupported'}
      onclick={() => void (vm.pushState === 'on' ? vm.disablePush() : vm.enablePush())}
      >{vm.pushState === 'on'
        ? ui.disableReminders
        : vm.pushState === 'missing'
          ? ui.turnOnAgain
          : ui.enableReminders}</Button
    ><ActionFeedback note={vm.actionNotes.reminders} />{#if vm.pushState === 'on'}<Button
        secondary
        onclick={() => void vm.testPush()}>{ui.sendTestPush}</Button
      ><ActionFeedback note={vm.actionNotes['test-push']} />{/if}
    <details>
      <summary>{ui.deliveryLog}</summary>{#if vm.deliveries.length}<ul>
          {#each vm.deliveries as delivery}<li>
              <small
                >{delivery.time ? new Date(delivery.time).toLocaleString() : ''} · {ui.pushProvider(
                  delivery.host,
                )}</small
              >
              <p>{ui.pushOutcome(delivery.host, delivery.status, delivery.reason)}</p>
            </li>{/each}
        </ul>{:else}<p>{ui.deliveryEmpty}</p>{/if}
    </details>
  </section>
  <section class="settings-group" aria-labelledby="privacy-heading">
    <h3 id="privacy-heading">{incord.privacy}</h3>
    <label
      ><input
        type="checkbox"
        bind:checked={vm.shareCounts}
        disabled={vm.privacySignal}
        onchange={(event) => void vm.setShareCounts(event)}
      />{incord.shareCounts}</label
    ><ActionFeedback note={vm.actionNotes.privacy} /><small>{incord.countsDetail}</small
    >{#if vm.privacySignal}<small>{incord.privacySignal}</small>{/if}
  </section>
  <section class="settings-group" aria-label={ui.dataLabel}>
    <Button secondary onclick={() => void vm.exportData()}>{ui.exportData}</Button><ActionFeedback
      note={vm.actionNotes.export}
    />{#if vm.account}<Button
        secondary
        onclick={() => {
          vm.clearAction('delete');
          vm.confirmDelete = true;
        }}>{ui.deleteAccount}</Button
      >{/if}<ActionFeedback note={vm.actionNotes.deleted} />
  </section>
  <section class="settings-group" aria-labelledby="send-feedback-heading">
    <h3 id="send-feedback-heading">{ui.feedbackTitle}</h3>
    <p>{ui.feedbackDetail}</p>
    <form
      class="stack feedback-form"
      aria-label={ui.feedbackTitle}
      novalidate
      onsubmit={(event) => {
        event.preventDefault();
        void vm.sendFeedback();
      }}
      autocomplete="off"
    >
      <label
        >{ui.feedbackKind}<select
          bind:value={vm.feedbackKind}
          disabled={vm.feedbackBusy}
          aria-label={ui.feedbackKind}
          >{#each ui.feedbackKinds as kind}<option>{kind}</option>{/each}</select
        ></label
      >
      <label
        >{ui.feedbackMessage}<textarea
          bind:value={vm.feedbackMessage}
          minlength={10}
          maxlength={4000}
          required
          disabled={vm.feedbackBusy}
          aria-describedby="feedback-message-help"></textarea></label
      ><small id="feedback-message-help">{ui.feedbackMessageHelp}</small>
      <label
        >{ui.feedbackContact}<input
          name="feedback-reply"
          type="email"
          bind:value={vm.feedbackContact}
          maxlength={254}
          disabled={vm.feedbackBusy}
          autocomplete="off"
          aria-describedby="feedback-contact-help"
        /></label
      ><small id="feedback-contact-help">{ui.feedbackContactHelp}</small>
      <label class="toggle"
        ><input
          type="checkbox"
          bind:checked={vm.feedbackIncludeMeta}
          disabled={vm.feedbackBusy}
          aria-describedby="feedback-meta-help"
        />{ui.feedbackIncludeMeta}</label
      ><small id="feedback-meta-help">{ui.feedbackMetaHelp}</small>
      <button
        type="submit"
        disabled={vm.feedbackBusy}
        aria-busy={vm.feedbackBusy}
        class:feedback-sending={vm.feedbackBusy}
        >{vm.feedbackBusy ? ui.feedbackSending : ui.feedbackSend}</button
      >
      <p
        aria-live="polite"
        aria-atomic="true"
        class:sr-only={!vm.feedbackError && !vm.feedbackStatus}
        class="feedback-result"
        class:feedback-failed={!!vm.feedbackError}
        bind:this={vm.feedbackResult}
        role={vm.feedbackError ? 'alert' : vm.feedbackStatus ? 'status' : undefined}
        tabindex="-1"
      >
        {vm.feedbackError || vm.feedbackStatus}
      </p>
    </form>
  </section>
  <section class="settings-group" aria-label={ui.aboutLabel}>
    <h3>{ui.aboutVersion(appVersion)}</h3>
    <small>{ui.aboutApp}</small><EsvAttribution translation={incord.esv} full />
    <p>{incord.privacyAbout}</p>
    <p>{ui.textSizeAccessibility}</p>
    <a href="/privacy">{incord.privacyPolicy}</a>{#if supportUrl(vm.config.donateUrl)}<a
        href={supportUrl(vm.config.donateUrl)!}
        rel="noopener noreferrer">{ui.supportIncord}</a
      >{/if}
  </section>
</div>
