/** User-facing language lives here, rather than in engine or components. */
export const copy = {
  app: { name: 'By Heart', tagline: 'A little, held close.' },
  tabs: { today: 'Today', library: 'Library', discover: 'Discover', account: 'Account' },
  common: { back: 'Back', close: 'Close', cancel: 'Cancel', save: 'Save', continue: 'Continue', done: 'Done', remove: 'Remove', add: 'Add', loading: 'Loading…', retry: 'Try again' },
  today: {
    title: 'Today', begin: 'Begin', doneTitle: 'Done for today', doneBody: 'A little practice goes a long way. Come back when you’re ready.',
    rhythm: (days: number, goal: number) => `${days} of ${goal} days this week`,
    count: (count: number) => `${count} ${count === 1 ? 'item' : 'items'} for today`,
    minutes: (minutes: number) => `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`,
  },
  practice: {
    title: 'Practice', peek: 'Peek', knowThis: 'I know this', restart: 'Start again', next: 'Continue',
    steps: ['Type along', 'A little hidden', 'A little more hidden', 'By heart'],
    step: (step: number) => `Step ${step} of 4`,
    learnedTitle: 'Learned, by heart.', learnedBody: 'Something worth keeping, now carried with you.',
    passedTitle: 'A little more, by heart.', repeatTitle: 'Let’s try that once more.', repeatBody: 'There’s no hurry. Each time makes it a little more familiar.',
    shortcutFailed: 'Let’s build from what you know.', reviewTitle: 'Held close', referenceDrill: 'Practice the reference too',
    slips: (slips: number) => `${slips} ${slips === 1 ? 'slip' : 'slips'}`,
    due: (date: string) => `Next practice: ${date}`,
  },
  gentleReturn: { title: 'Welcome back.', body: 'We’ll start small, with a few familiar words.', begin: 'Ease back in', quickCheck: 'See what I still know' },
  library: { title: 'Your library', starters: 'Start here', yours: 'Yours', empty: 'A place for words worth keeping.', practice: 'Practice', add: 'Add to library', remove: 'Remove from library' },
  discover: { title: 'Find your next words', scripture: 'Scripture', catechisms: 'Catechisms & creeds', custom: 'Add your own text', reference: 'Reference', translation: 'Translation', prompt: 'Title or prompt', text: 'Text to learn', private: 'Your own text stays private.', search: 'Find passage', add: 'Add to library', notFound: 'We couldn’t find that passage. Check the reference and try again.' },
  account: {
    title: 'Account', local: 'On this device', localBody: 'Practice freely. Sign in when you want to keep your words across devices.',
    signIn: 'Sign in with a passkey', signUp: 'Create a passkey', signOut: 'Sign out', google: 'Continue with Google', name: 'Display name', appearance: 'Appearance',
    system: 'System', light: 'Light', dark: 'Dark', weeklyGoal: 'Days each week', reminder: 'A gentle reminder', reminderTime: 'Reminder time', testPush: 'Send test notification',
    iosPush: 'To receive reminders on iPhone, add By Heart to your Home Screen.', export: 'Export your data', delete: 'Delete account', deleteConfirm: 'Delete your account and its saved data? This cannot be undone.',
    recovery: 'Your recovery code', recoveryBody: 'Keep this somewhere safe. It can be used once to sign in on a new device.', recoverySignIn: 'Use a recovery code', recoveryCode: 'Recovery code',
  },
  errors: { general: 'Something didn’t go through. Please try again.', offline: 'You’re offline. Your practice is saved on this device.', auth: 'We couldn’t sign you in. Please try again.', sync: 'Your practice is saved here. We’ll sync when you’re connected.' },
} as const;
export const COPY = copy;
