/** Best-effort, gesture-only feedback. No resources or device calls while off. */
export type FeedbackSettings = { keySounds?: boolean; haptics?: boolean };
export function supportsHaptics() {
  if (typeof navigator === 'undefined') return false;
  return typeof navigator.vibrate === 'function' || /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function createKeyboardFeedback() {
  let audio: AudioContext | undefined;
  let switchLabel: HTMLLabelElement | undefined;
  let container: HTMLDivElement | undefined;
  function play(settings: FeedbackSettings, slip = false) {
    if (settings.keySounds) {
      try {
        const Audio = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Audio) {
          audio ||= new Audio();
          if (audio.state === 'suspended') void audio.resume().catch(() => {});
          const oscillator = audio.createOscillator(), gain = audio.createGain();
          const now = audio.currentTime;
          oscillator.type = 'sine'; oscillator.frequency.value = slip ? 330 : 600;
          gain.gain.setValueAtTime(0.025, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
          oscillator.connect(gain); gain.connect(audio.destination);
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
          oscillator.start(now); oscillator.stop(now + 0.04);
        }
      } catch { /* Unsupported/blocked audio must never interrupt practice. */ }
    }
    if (settings.haptics && supportsHaptics()) {
      try {
        if (typeof navigator.vibrate === 'function') navigator.vibrate(8);
        else {
          if (!switchLabel) {
            container = document.createElement('div');
            container.setAttribute('aria-hidden', 'true');
            container.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
            const input = document.createElement('input');
            input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
            input.id = 'keyboard-haptic-' + crypto.randomUUID();
            switchLabel = document.createElement('label'); switchLabel.htmlFor = input.id;
            container.append(input, switchLabel); document.body.append(container);
          }
          const focused = document.activeElement;
          switchLabel.click();
          if (focused instanceof HTMLElement && document.activeElement !== focused) focused.focus({ preventScroll: true });
        }
      } catch { /* iOS switch haptics are best effort, not an input dependency. */ }
    }
  }
  return { play, destroy() { container?.remove(); container = undefined; switchLabel = undefined; if (audio) void audio.close().catch(() => {}); audio = undefined; } };
}
