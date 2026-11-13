/** Best-effort gesture feedback. Normal playback allocates nothing while off. */
export type FeedbackSettings = { keySounds?: boolean; haptics?: boolean };

function supportsSwitchHaptics() {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Be conservative on iOS: some embedded WebKit versions do not expose the
  // switch property even when native activation can work. The setting explains
  // the iOS 18/System Haptics requirement; unsupported versions remain inert.
  return ios;
}
export function supportsHaptics() {
  return typeof navigator !== 'undefined'
    && (typeof navigator.vibrate === 'function' || supportsSwitchHaptics());
}

export function createKeyboardFeedback() {
  let audio: AudioContext | undefined;
  let pendingTick: { play: () => void; queuedAt: number } | undefined;
  let soundEnabled = false;
  let generation = 0;
  let destroyed = false;
  const active = new Set<() => void>();

  /** Call on preference changes as well as play, to cancel queued/active sounds immediately. */
  function setSettings(settings: FeedbackSettings) {
    soundEnabled = !!settings.keySounds;
    if (!soundEnabled) {
      generation++;
      pendingTick = undefined;
      for (const stop of active) stop();
    }
  }

  function getAudio() {
    if (destroyed || typeof window === 'undefined') return;
    if (audio) return audio;
    try {
      const Audio = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      // Ambient respects the hardware silent switch and does not interrupt other audio.
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) { try { session.type = 'ambient'; } catch { /* Optional WebKit API. */ } }
      audio = new Audio();
      return audio;
    } catch { /* Unsupported/blocked audio must never interrupt practice. */ }
  }

  function flushPendingTick(context: AudioContext) {
    if (context.state !== 'running') return;
    const tick = pendingTick;
    pendingTick = undefined;
    // A suspended context must not replay a backlog when iOS finally unlocks it.
    if (tick && Date.now() - tick.queuedAt <= 100) tick.play();
  }

  function whenRunning(context: AudioContext, callback?: () => void) {
    if (callback) pendingTick = { play: callback, queuedAt: Date.now() };
    if (context.state === 'running') { flushPendingTick(context); return; }
    if (context.state === 'closed') { pendingTick = undefined; return; }
    // Never coalesce resume calls: a touchstart promise can hang indefinitely,
    // while a later touchend/click has the activation WebKit needs to succeed.
    try {
      void context.resume().then(() => flushPendingTick(context), () => {});
    } catch { /* Another genuine gesture may successfully retry. */ }
  }

  /** Wire to practice gesture starts/ends/clicks (not only keys); inert while off. */
  function unlockAudioContext(settings?: FeedbackSettings) {
    if (settings) setSettings(settings);
    if (!soundEnabled || destroyed) return;
    const context = getAudio();
    if (!context) return;
    whenRunning(context);
    // Start inside this gesture, even when resume is still pending. Waiting for
    // its promise loses the transient user activation on affected iOS versions.
    try {
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, context.sampleRate);
      source.connect(context.destination);
      source.onended = () => source.disconnect();
      source.start();
    } catch { /* Silent one-sample unlock is best effort. */ }
  }

  function sound(slip: boolean, preview = false) {
    if (destroyed || (!preview && !soundEnabled)) return;
    const context = getAudio();
    if (!context) return;
    const token = generation;
    whenRunning(context, () => {
      if (destroyed || token !== generation || (!preview && !soundEnabled)) return;
      try {
        const oscillator = context.createOscillator(), gain = context.createGain();
        const now = context.currentTime, duration = slip ? 0.06 : 0.05;
        oscillator.type = 'triangle';
        oscillator.frequency.value = slip ? 280 : 520;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(slip ? 0.2 : 0.3, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        oscillator.connect(gain); gain.connect(context.destination);
        const cleanup = () => { active.delete(stop); oscillator.disconnect(); gain.disconnect(); };
        const stop = () => { try { oscillator.stop(); } catch { /* Already ended. */ } cleanup(); };
        oscillator.onended = cleanup;
        active.add(stop);
        oscillator.start(now); oscillator.stop(now + duration);
      } catch { /* Feedback cannot block input. */ }
    });
  }

  function haptic() {
    if (destroyed || typeof navigator === 'undefined') return;
    try {
      if (typeof navigator.vibrate === 'function') { navigator.vibrate(8); return; }
      if (!supportsSwitchHaptics()) return;
      // Must run synchronously in the gesture. Leave no hidden controls behind.
      const focused = document.activeElement;
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
      label.append(input);
      try {
        document.head.append(label);
        label.click();
      } finally {
        label.remove();
        if (focused instanceof HTMLElement && document.activeElement !== focused) focused.focus({ preventScroll: true });
      }
    } catch { /* Switch haptics are best effort, not an input dependency. */ }
  }

  /** Deliberately synchronous: iOS haptics must precede any asynchronous audio resume. */
  function play(settings: FeedbackSettings, slip = false) {
    setSettings(settings);
    if (settings.haptics) haptic();
    if (settings.keySounds) sound(slip);
  }
  return {
    play, setSettings, unlockAudioContext, unlock: unlockAudioContext,
    testSound(slip = false) { sound(slip, true); },
    testHaptic() { haptic(); },
    destroy() {
      destroyed = true;
      setSettings({});
      if (audio) { try { void audio.close().catch(() => {}); } catch { /* Best effort. */ } }
      audio = undefined;
      pendingTick = undefined;
    },
  };
}
