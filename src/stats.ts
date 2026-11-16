/** Anonymous first-party counters. Only fixed categorical names enter this queue. */
export const STATS_EVENTS = [
  'app_open',
  'practice_start',
  'learned',
  'own_text_added',
  'welcome_back_shown',
  'reminders_enabled',
  'account_created',
  'client_error',
  ...[1, 2, 3, 4].flatMap((n) => [`step_pass:${n}`, `step_fail:${n}`]),
  'i_know_this:pass',
  'i_know_this:fail',
  ...['again', 'hard', 'good', 'easy'].map((x) => `review:${x}`),
  ...['gospel', 'wsc-start', 'heidelberg-start', 'apostles-start', 'psalm23'].map(
    (x) => `starter_added:${x}`,
  ),
  ...['bsb', 'kjv', 'web', 'esv'].map((x) => `translation_added:${x}`),
  ...[
    'wsc',
    'heidelberg',
    'apostles',
    'nicene',
    'wlc',
    'baptist',
    'spurgeon',
    'young-children',
  ].map((x) => `doc_items_added:${x}`),
  'push_test:sent',
  'push_test:failed',
  ...['small', 'default', 'large', 'extra-large'].map((x) => `text_size:${x}`),
  ...['system', 'light', 'dark'].map((x) => `theme:${x}`),
] as const;
const allowed = new Set<string>(STATS_EVENTS);
export const STATS_PREFERENCE_KEY = 'incord.stats.enabled';
export const STATS_TOKEN_KEY = 'incord.stats.daily';
export const statsPrivacyCopy =
  'Incord counts anonymous totals (like how many people practiced today) to improve the app. No ads, no third-party trackers.';
export const statsToggleExplanation =
  'Share daily anonymous counts, never your identity or the words you practice. Your browser’s privacy preference takes priority.';
export function localStatsDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function browserPrivacyOff(nav: Navigator = navigator) {
  return (
    !!(nav as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl ||
    nav.doNotTrack === '1' ||
    nav.doNotTrack === 'yes' ||
    (typeof window !== 'undefined' &&
      (window as Window & { doNotTrack?: string }).doNotTrack === '1')
  );
}
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value?: string) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Storage may be disabled. No fallback persistent identifiers. */
  }
}
export function statsEnabled() {
  return (
    typeof navigator !== 'undefined' && !browserPrivacyOff() && read(STATS_PREFERENCE_KEY) !== '0'
  );
}
let queue: string[] = [],
  tokenDay = '',
  token = '',
  timer: ReturnType<typeof setTimeout> | undefined;
function clear() {
  queue = [];
  tokenDay = '';
  token = '';
  write(STATS_TOKEN_KEY);
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}
export function setStatsEnabled(enabled: boolean) {
  write(STATS_PREFERENCE_KEY, enabled ? '1' : '0');
  if (!enabled || !statsEnabled()) clear();
}
/** A single stored token is replaced, not appended, at each LOCAL day boundary. */
export function dailyStatsToken(now = new Date()) {
  if (!statsEnabled()) {
    clear();
    return null;
  }
  const day = localStatsDay(now);
  if (tokenDay === day && token) return token;
  // Drop yesterday's unsent events instead of linking them to a new day's token.
  queue = [];
  let stored: { day?: string; token?: string } = {};
  try {
    stored = JSON.parse(read(STATS_TOKEN_KEY) || '{}') || {};
  } catch {
    /* replace malformed storage */
  }
  tokenDay = day;
  token =
    stored.day === day && typeof stored.token === 'string' && /^[a-f0-9]{32}$/.test(stored.token)
      ? stored.token
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) =>
          x.toString(16).padStart(2, '0'),
        ).join('');
  write(STATS_TOKEN_KEY, JSON.stringify({ day, token }));
  return token;
}
export function trackStats(event: string) {
  if (!allowed.has(event)) return;
  if (!statsEnabled()) {
    clear();
    return;
  }
  dailyStatsToken();
  if (queue.length < 50) queue.push(event);
  if (queue.length === 50) {
    void flushStats();
    return;
  }
  if (timer === undefined)
    timer = setTimeout(() => {
      timer = undefined;
      void flushStats();
    }, 5000);
}
export async function flushStats() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  if (!statsEnabled()) {
    clear();
    return;
  }
  const current = dailyStatsToken();
  if (!current || !queue.length) return;
  const events = queue.splice(0, 50);
  // Credentials are explicitly omitted: even the account cookie is unnecessary.
  // Failed sends are dropped; no disk queue or retry can link days or inflate counts.
  try {
    await fetch('/api/stats', {
      method: 'POST',
      credentials: 'omit',
      mode: 'same-origin',
      referrerPolicy: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: current, events }),
      keepalive: true,
    });
  } catch {
    /* Best-effort totals, never block offline practice. */
  }
}
/** Install once from App onMount; call its disposer on unmount. */
export function installStats() {
  const visibility = () => {
    if (document.visibilityState === 'hidden') void flushStats();
  };
  const storage = (event: StorageEvent) => {
    if (event.key === STATS_PREFERENCE_KEY && !statsEnabled()) clear();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', visibility);
  window.addEventListener('storage', storage);
  trackStats('app_open');
  return () => {
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', visibility);
    window.removeEventListener('storage', storage);
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}
