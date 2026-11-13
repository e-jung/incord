import {plural} from './format';
/** User-facing language lives here, rather than in engine or components. */
export const copy = {
  app: { name: 'By Heart', tagline: '' },
  tabs: { today: 'Today', library: 'Library', discover: 'Discover', account: 'Account' },
  common: { back: 'Back', close: 'Close', cancel: 'Cancel', save: 'Save', continue: 'Continue', done: 'Done', remove: 'Remove', add: 'Add', loading: 'Loading…', retry: 'Try again' },
  today: {
    title: 'Today', begin: 'Begin', doneTitle: 'Done for today', doneBody: '',
    rhythm: (days: number, goal: number) => `${days} of ${goal} this week`,
    count: (count: number) => `${plural(count, 'item')} to practice`,
    minutes: (minutes: number) => `About ${plural(minutes, 'min', 'min')}`,
  },
  practice: {
    title: 'Practice', peek: 'Peek', knowThis: 'I know this', restart: 'Start again', next: 'Continue',
    steps: ['Type along', 'Some words hidden', 'More words hidden', 'By heart'],
    step: (step: number) => `Step ${step} of 4`,
    learnedTitle: 'Learned', learnedBody: '',
    passedTitle: 'Step passed', repeatTitle: 'One more time', repeatBody: '',
    shortcutFailed: 'Continue at step 3', reviewTitle: 'Review', referenceDrill: 'Practice the reference too',
    slips: (slips: number) => `${plural(slips, 'slip')}`,
    due: (date: string) => `Next practice: ${date}`,
  },
  gentleReturn: { title: 'Welcome back', body: 'Three today. A few more each day this week.', begin: 'Start', quickCheck: 'Check what I remember' },
  library: { title: 'Your library', starters: 'Start here', yours: 'Yours', empty: 'No items yet.', practice: 'Practice', add: 'Add to library', remove: 'Remove from library' },
  discover: { title: 'Discover', scripture: 'Scripture', catechisms: 'Catechisms & creeds', custom: 'Add your own text', reference: 'Reference', translation: 'Translation', prompt: 'Title or prompt', text: 'Text to learn', private: 'Your own text stays private.', search: 'Find passage', add: 'Add to library', notFound: 'We couldn’t find that passage. Check the reference and try again.' },
  account: {
    title: 'Account', local: 'On this device', localBody: 'Sign in to sync across devices.',
    signIn: 'Sign in with a passkey', signUp: 'Create a passkey', signOut: 'Sign out', google: 'Continue with Google', name: 'Display name', appearance: 'Appearance',
    system: 'System', light: 'Light', dark: 'Dark', weeklyGoal: 'Days each week', reminder: 'A gentle reminder', reminderTime: 'Reminder time', testPush: 'Send test notification',
    iosPush: 'To receive reminders on iPhone, add By Heart to your Home Screen.', export: 'Export your data', delete: 'Delete account', deleteConfirm: 'Delete your account and its saved data? This cannot be undone.',
    recovery: 'Your recovery code', recoveryBody: 'Keep this somewhere safe. It can be used once to sign in on a new device.', recoverySignIn: 'Use a recovery code', recoveryCode: 'Recovery code',
  },
  errors: { general: 'Something didn’t go through. Please try again.', offline: 'You’re offline. Your practice is saved on this device.', auth: 'We couldn’t sign you in. Please try again.', sync: 'Your practice is saved here. We’ll sync when you’re connected.' },
} as const;
export const COPY = copy;
