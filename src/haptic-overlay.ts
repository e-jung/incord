import type {FeedbackSettings} from './keyboard-feedback';

/** iOS switch haptics need a real tap. No imperative click/label fallback. */
export function usesHapticOverlay(settings: FeedbackSettings, platform = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return !!settings.haptics && !!platform && typeof platform.vibrate !== 'function'
    && (/iPhone|iPad|iPod/.test(platform.userAgent) || (platform.platform === 'MacIntel' && platform.maxTouchPoints > 1));
}
type Options = {enabled: boolean; onpress: () => void};
/** B: a native switch beside (never inside) the accessible button. */
export function hapticOverlay(button: HTMLButtonElement, initial: Options) {
  let options = initial;
  let wrapper: HTMLSpanElement | undefined;
  let input: HTMLInputElement | undefined;
  let focus: HTMLElement | null = null;
  let pressedTimer: ReturnType<typeof setTimeout> | undefined;
  const remember = () => { focus = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  const click = () => {
    if (!input || button.disabled) return;
    const switchInput = input;
    button.classList.add('haptic-pressed');
    clearTimeout(pressedTimer);
    pressedTimer = setTimeout(() => button.classList.remove('haptic-pressed'), 150);
    // The trusted native click toggles normally. A sibling cannot activate the
    // button, so dispatch once directly, with no scripted click or cancellation.
    options.onpress();
    if (focus?.isConnected && (document.activeElement === switchInput || document.activeElement === document.body)) {
      focus.focus({preventScroll:true});
    }
    focus = null;
  };
  function remove() {
    input?.removeEventListener('pointerdown', remember);
    input?.removeEventListener('click', click);
    input?.remove(); input = undefined;
    // Put the original node back before Svelte removes/reconciles it. Do not
    // clone the button: its listeners, bindings and accessibility stay intact.
    if (wrapper) { wrapper.replaceWith(button); wrapper = undefined; }
    clearTimeout(pressedTimer);
    button.classList.remove('haptic-pressed');
    focus = null;
  }
  function update(next: Options) {
    options = next;
    if (!usesHapticOverlay({haptics:next.enabled})) { remove(); return; }
    if (!input && button.parentNode) {
      wrapper = document.createElement('span');
      wrapper.className = 'haptic-target';
      if (button.classList.contains('key')) wrapper.classList.add('haptic-key');
      if (button.classList.contains('number-key')) wrapper.classList.add('haptic-number-key');
      button.before(wrapper);
      wrapper.append(button);
      input = document.createElement('input');
      input.type = 'checkbox'; input.setAttribute('switch','');
      input.setAttribute('aria-hidden','true'); input.tabIndex = -1;
      input.className = 'haptic-overlay';
      input.addEventListener('pointerdown',remember);
      input.addEventListener('click',click);
      wrapper.append(input);
    }
    if (input) input.disabled = button.disabled;
  }
  update(initial);
  return {update,destroy:remove};
}
