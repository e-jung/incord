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
  let noiseBuffer: AudioBuffer | undefined;
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
        // A short filtered noise transient supplies the crisp key surface;
        // the much quieter sine adds a little tactile body without a pitched beep.
        const now = context.currentTime, duration = slip ? 0.028 : 0.024;
        if (!noiseBuffer) {
          noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.03), context.sampleRate);
          const samples = noiseBuffer.getChannelData(0);
          for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        }
        const noise = context.createBufferSource(), high = context.createBiquadFilter(), low = context.createBiquadFilter();
        const gain = context.createGain(), body = context.createOscillator(), bodyGain = context.createGain();
        noise.buffer = noiseBuffer;
        high.type = 'highpass'; high.frequency.value = slip ? 1400 : 2000; high.Q.value = 0.707;
        low.type = 'lowpass'; low.frequency.value = slip ? 4200 : 6000; low.Q.value = 0.707;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(slip ? 0.18 : 0.22, now + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        body.type = 'sine'; body.frequency.value = slip ? 150 : 175;
        bodyGain.gain.setValueAtTime(0, now);
        bodyGain.gain.linearRampToValueAtTime(slip ? 0.02 : 0.025, now + 0.001);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.01);
        noise.connect(high); high.connect(low); low.connect(gain); gain.connect(context.destination);
        body.connect(bodyGain); bodyGain.connect(context.destination);
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          active.delete(stop);
          noise.disconnect(); high.disconnect(); low.disconnect(); gain.disconnect(); body.disconnect(); bodyGain.disconnect();
        };
        const stop = () => {
          try { noise.stop(); } catch { /* Already ended. */ }
          try { body.stop(); } catch { /* Already ended. */ }
          cleanup();
        };
        noise.onended = cleanup;
        active.add(stop);
        noise.start(now); noise.stop(now + duration);
        body.start(now); body.stop(now + 0.01);
      } catch { /* Feedback cannot block input. */ }
    });
  }

  function haptic() {
    if (destroyed || typeof navigator === 'undefined') return;
    try {
      if (typeof navigator.vibrate === 'function') { navigator.vibrate(8); return; }
      // On iOS only the user's direct tap on haptic-overlay.ts can tick.
      // Physical keys and scripted clicks deliberately have no iOS fallback.
    } catch { /* Vibration is best effort, not an input dependency. */ }
  }

  /** Android vibration stays synchronous; iOS haptics are native tap overlays. */
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
      noiseBuffer = undefined;
      pendingTick = undefined;
    },
  };
}
