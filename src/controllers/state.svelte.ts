import type { AppCommands } from './commands';
import type { ActionNote, GroupAttention, Consent, ConnectedApp } from './types';
import { readDeviceSignInCode, type DeviceSignInCode } from '../sign-in-code';

import { type DevicePush, type Delivery } from '../notifications';

import { copy as ui, plural } from '../config/copy';
import { createKeyboardFeedback, supportsHaptics } from '../keyboard-feedback';
import { dailyPlan, estimateMinutes } from '../daily';

import { RULES } from '../config/rules';
import { type TapUndo } from '../engine/undo';
import { tokenize, maskWords, gentleCap } from '../engine';
import { starters, documents } from '../content';
import { passages } from '../passages';
import { topics } from '../topics';
import {
  api,
  installQueueRetry,
  sortItems,
  defaults,
  today,
  type LocalState,
  type Item,
} from '../store';
import { createAccountController } from './account.svelte';
import { createSigninController } from './signin.svelte';
import { createPracticeController } from './practice.svelte';
import { createNavigationController } from './navigation.svelte';
import { createSyncController } from './sync.svelte';
import { createDiscoveryController } from './discovery.svelte';
import { createPreferencesController } from './preferences.svelte';
import { createActionsController } from './actions.svelte';

function readGroupInvite(): string {
  const path = /^\/join\/([a-z0-9-]+)\/?$/i.exec(location.pathname);
  const normalize = (code: string) => code.toLowerCase().replace(/-/g, '');
  try {
    const code = normalize(path?.[1] || sessionStorage.getItem('bh_group_join') || '');
    if (!/^[abcdefghjkmnpqrstuvwxyz23456789]{16}$/.test(code)) return '';
    sessionStorage.setItem('bh_group_join', code);
    return code;
  } catch {
    return path && /^[abcdefghjkmnpqrstuvwxyz23456789]{16}$/.test(normalize(path[1]))
      ? normalize(path[1])
      : '';
  }
}
function oauthReturn(value: string | null): string | null {
  if (!value || !value.startsWith('/oauth/authorize?')) return null;
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin && url.pathname === '/oauth/authorize' && !url.hash
      ? url.pathname + url.search
      : null;
  } catch {
    return null;
  }
}
function resumeOauth() {
  try {
    const pending = oauthReturn(sessionStorage.getItem('bh_oauth_return'));
    sessionStorage.removeItem('bh_oauth_return');
    if (location.pathname === '/' && pending) history.replaceState(null, '', pending);
  } catch {
    /* Sign-in still works without session storage. */
  }
}
function initialDiscoverFilter() {
  try {
    const value = sessionStorage.getItem('bh_discover_filter');
    return ui.discoverFilters.includes(value as any) ? value! : ui.topics;
  } catch {
    return ui.topics;
  }
}
export interface AppRuntime extends AppState, AppCommands {}
// Retain the existing independent state flags; controllers receive narrow typed views.
export class AppState {
  feedback = createKeyboardFeedback();
  hapticsSupported = supportsHaptics();
  actionNotes = $state<Record<string, ActionNote>>({});
  actionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  runningActions = new Set<string>();
  busyActions = 0;
  pendingGroupCode = $state(readGroupInvite());
  initialGroupId = $state('');
  goalTarget = $state('');
  groupGoalBusy = $state(false);
  groupGoalError = $state('');
  groupGoalStart = $state(1);
  groupGoalEnd = $state(12);
  resumedGroupInvite = '';
  groupAttention = $state<GroupAttention | null>(null);
  attentionIdentity = '';
  attentionRequest = 0;
  attentionUpdated = 0;
  attentionDirty = false;
  returnToGroups = false;
  groupDialogClose = $state<(() => void) | null>(null);
  jlQuery = new URLSearchParams(location.search);
  jlConfirmRequested = this.jlQuery.get('jlConfirm') === '1';
  jlOptionsRequested = this.jlQuery.get('jlOptions') === '1';
  oauthRestored = (resumeOauth(), true);
  oauthRoute = location.pathname === '/oauth/authorize';
  oauthSearch = location.search;
  googleLinkResult = new URLSearchParams(location.search).get('googleLink');
  initialGoogleLinkError =
    this.googleLinkResult === 'collision'
      ? ui.codeAccount.googleCollision
      : this.googleLinkResult === 'expired'
        ? ui.codeAccount.googleExpired
        : this.googleLinkResult === 'failed'
          ? ui.codeAccount.googleFailed
          : '';
  googleLinkError = $state(this.initialGoogleLinkError);
  identityVerified = $state(false);
  consent = $state<Consent | null>(null);
  consentBusy = $state(false);
  consentError = $state('');
  consentDecision = $state<'approve' | 'deny' | null>(null);
  connectedApps = $state<ConnectedApp[]>([]);
  appsLoading = $state(false);
  appsError = $state('');
  revoking = $state('');
  revokedApps = $state<ConnectedApp[]>([]);
  consentRequest = 0;
  appsRequest = 0;
  jlEmail = $state('');
  jlBusy = $state(false);
  jlError = $state(this.jlQuery.has('jlError') ? ui.jesklabs.retry : '');
  jlOptions = $state(this.jlOptionsRequested);
  data = $state<LocalState>({ items: [], events: [], settings: { ...defaults }, queue: [] });
  ready = $state(false);
  tab = $state<string>(
    location.pathname === ui.galleryPath && (import.meta.env.DEV || localStorage.debug === '1')
      ? ui.gallery
      : this.oauthRoute ||
          this.googleLinkResult ||
          this.jlConfirmRequested ||
          this.jlOptionsRequested
        ? ui.account
        : !!this.pendingGroupCode || location.pathname.startsWith('/join/')
          ? ui.groups.heading
          : ui.today,
  );
  detail = $state<string>(ui.empty);
  practice = $state<Item | null>(null);
  session = $state<string[]>([]);
  position = $state(0);
  slips = $state<number[]>([]);
  result = $state(false);
  learned = $state(false);
  shortcut = $state(false);
  review = $state(false);
  message = $state<string>(ui.empty);
  error = $state<string>(ui.empty);
  busy = $state(false);
  account = $state<any>(null);
  config = $state<any>({});
  confirmDelete = $state(false);
  welcome = $state(false);
  addMode = $state<string>(ui.verseMode);
  reference = $state<string>(ui.empty);
  customTitle = $state<string>(ui.empty);
  customText = $state<string>(ui.empty);
  found = $state<any[]>([]);
  selectedDoc = $state<string>(ui.empty);
  nextDue = $state<string>(ui.empty);
  prayerAttention = $derived(
    this.data.settings.groupReceivePrayer !== false ? this.groupAttention?.prayersToday || 0 : 0,
  );
  attentionAccount = $derived<string>(this.identityVerified ? this.account?.id || '' : '');
  discoverFilter = $state(initialDiscoverFilter());
  discoverFilters = ui.discoverFilters;
  pushState = $state<DevicePush>('off');
  deliveries = $state<Delivery[]>([]);
  practiceRegion = $state<HTMLElement>();
  deviceCode = $state<DeviceSignInCode | null>(readDeviceSignInCode());
  codeEntry = $state('');
  codeBusy = $state('');
  codeSaved = $state(false);
  codeRevealed = $state(false);
  codeConfirm = $state<'' | 'regenerate' | 'remove'>('');
  codeReminder = $state(0);
  awaitingCodeSave = $derived(
    !!this.deviceCode?.pending && this.deviceCode.uid === this.account?.id,
  );
  printableCode = $derived(
    this.awaitingCodeSave || this.codeRevealed ? this.deviceCode?.code || '' : '',
  );
  emailAddress = $state('');
  emailCode = $state('');
  emailSent = $state(false);
  emailLink = $state(false);
  emailOpen = $state(false);
  emailBusy = $state('');
  emailError = $state('');
  emailErrorControl = $state('');
  emailStatus = $state('');
  resendSeconds = $state(0);
  feedbackKind = $state<'Idea' | 'Problem' | 'Other'>('Idea');
  feedbackMessage = $state('');
  feedbackContact = $state('');
  feedbackIncludeMeta = $state(true);
  feedbackBusy = $state(false);
  feedbackStatus = $state('');
  feedbackError = $state('');
  feedbackResult = $state<HTMLParagraphElement>();
  feedbackTimer!: ReturnType<typeof setTimeout>;
  emailStatusTimer!: ReturnType<typeof setTimeout>;
  batchTimer!: ReturnType<typeof setTimeout>;
  resendUntil = 0;
  shareCounts = $state(true);
  privacySignal = $state(false);
  loadingPassage = $state(false);
  passageRequest = 0;
  practiceLoadRequest = 0;
  undoTimer!: ReturnType<typeof setTimeout>;
  screen = $derived(
    JSON.stringify([
      this.tab,
      this.detail,
      this.practice?.id || '',
      this.addMode,
      this.selectedDoc,
    ]),
  );
  previousScreen = '';
  tapUndo = $state<TapUndo | null>(null);
  typedLetter = $state('');
  typedSlip = $state(false);
  practiceAnnouncement = $state('');
  hasTapped = $state(false);
  confirmLeavePractice = $state(false);
  showPracticeInstruction = $state(false);
  letterTimer!: ReturnType<typeof setTimeout>;
  tapUndoTimer!: ReturnType<typeof setTimeout>;
  completing = $state(false);
  visualSlips = $state<number[]>([]);
  rehearsal = $state(false);
  resultTitle = $state('');
  resultDetail = $state('');
  resultLearned = $state(false);
  online = $state(navigator.onLine);
  preview = $state<any>(null);
  removeTarget = $state<Item | null>(null);
  undoItem = $state<Item | null>(null);
  passageMode = $state('passage');
  titleExpanded = $state(false);
  confirmEverywhere = $state(false);
  confirmBatch = $state<any[] | null>(null);
  batchCollection = $state<string | undefined>();
  batchAdded = $state(false);
  confirmSignout = $state(false);
  mergePrompt = $state(false);
  mergeDismissed = $state(false);
  discardPrompt = $state(false);
  zoneSearch = $state('');
  zones = [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])];
  attemptStep = $derived(
    this.review || this.shortcut || this.rehearsal ? 4 : this.practice?.step || 1,
  );
  live = $derived(sortItems(this.data.items.filter((i) => !i.deleted)));
  calendarDays = (date: string) =>
    Math.max(0, Math.round((Date.parse(today()) - Date.parse(date)) / 86400000) || 0);
  daysAway = $derived(
    this.data.settings.lastActive ? this.calendarDays(this.data.settings.lastActive) : 0,
  );
  rampDay = $derived(
    this.data.settings.returnStart ? this.calendarDays(this.data.settings.returnStart) : 7,
  );
  cap = $derived(
    gentleCap(
      this.data.settings.returnStart && this.rampDay < 7 ? 7 : this.daysAway,
      this.daysAway >= 7 && this.rampDay >= 7 ? 0 : this.rampDay,
      RULES.daily.normalCap,
    ),
  );
  newLimit = $derived(Number((this.data.settings as any).newPerDay) || 3);
  due = $derived(
    dailyPlan(
      this.live,
      this.data.events,
      today(),
      this.newLimit,
      Date.now(),
      this.daysAway >= 7 || (this.data.settings.returnStart && this.rampDay < 7)
        ? this.cap
        : Infinity,
    ),
  );
  estimatedMinutes = $derived(estimateMinutes(this.due));
  words = $derived(this.practice ? tokenize(this.practice.text) : []);
  mask = $derived(this.practice ? maskWords(this.practice.text, this.attemptStep) : []);
  hidden = $derived(this.mask.filter(Boolean).length);
  detailItems = $derived(this.live.filter((i) => i.collection === this.detail));
  weekCount = $derived(
    this.data.settings.days.filter((d) => {
      const date = new Date(d + ui.middaySuffix);
      const now = new Date();
      now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      now.setHours(0, 0, 0, 0);
      return date >= now;
    }).length,
  );
  previousTranslation: string | undefined;
  scriptureGeneration = 0;
  savedSettings = structuredClone(defaults);
  queueRetry!: ReturnType<typeof installQueueRetry>;
  syncing = false;
  syncAgain = false;
  addTarget = $state<string>(ui.empty);
  modalOpen = false;
  suppressPop = false;
  collectionTitle = (id: string) =>
    starters.find((s) => s.id === id)?.title ||
    documents.find((d) => d.id === id)?.title ||
    topics.find((t) => `topic-${t.id}` === id)?.title ||
    { bible: ui.myVerses, personal: ui.myTexts }[id] ||
    (id === 'passages' ? ui.passages : ui.myTexts);
  documentSubtitle = (doc: (typeof documents)[number]) => {
    const count = ['apostles', 'nicene'].includes(doc.id)
      ? plural(doc.items.length, 'article')
      : ui.questionCount(doc.questionCount || new Set(doc.items.map((item) => item.number)).size);
    const description =
      ui.documentDescriptions[doc.id as keyof typeof ui.documentDescriptions] || doc.subtitle;
    return `${count} · ${description}`;
  };
}
export function createAppState(): AppRuntime {
  const vm = new AppState() as AppRuntime;
  const commands: AppCommands = {
    ...createAccountController(vm),
    ...createSigninController(vm),
    ...createPracticeController(vm),
    ...createNavigationController(vm),
    ...createSyncController(vm),
    ...createDiscoveryController(vm),
    ...createPreferencesController(vm),
    ...createActionsController(vm),
  };
  Object.assign(vm, commands);
  vm.queueRetry = installQueueRetry(
    () => !!vm.account && !vm.awaitingCodeSave && !vm.mergePrompt && vm.data.queue.length > 0,
    async () => {
      const out = await api('/me');
      await vm.refreshIdentity(out.user || null, out.signedOutEverywhere);
    },
  );
  try {
    vm.returnToGroups = sessionStorage.getItem('bh_groups_return') === '1';
  } catch {}
  if (vm.jlOptionsRequested) {
    try {
      sessionStorage.setItem('bh_jl_options', '1');
    } catch {}
  }
  return vm;
}
