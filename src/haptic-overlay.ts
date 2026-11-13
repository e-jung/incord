import type {FeedbackSettings} from './keyboard-feedback';

/** iOS switch haptics need a real tap. No imperative click/label fallback. */
export function usesHapticOverlay(settings: FeedbackSettings, platform = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return !!settings.haptics && !!platform && typeof platform.vibrate !== 'function'
    && (/iPhone|iPad|iPod/.test(platform.userAgent) || (platform.platform === 'MacIntel' && platform.maxTouchPoints > 1));
}
type Options = {enabled: boolean; onpress: () => void};
/** The input keeps native appearance and default toggle activation; never prevent its click. */
export function hapticOverlay(button: HTMLButtonElement, initial: Options) {
  let options = initial;
  let input: HTMLInputElement | undefined;
  let focus: HTMLElement | null = null;
  const remember = () => { focus = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  const avoidMouseFocus = (event: MouseEvent) => event.preventDefault();
  const click = (event: MouseEvent) => {
    if (event.target !== input) return;
    // Run the same action directly, not button.click(): otherwise it fires twice.
    event.stopImmediatePropagation();
    if (!button.disabled) options.onpress();
    // Safari may focus the switch before click. Return to the original region,
    // but don't steal focus after an action navigates away or removes the input.
    if (focus?.isConnected) focus.focus({preventScroll:true});
  };
  function update(next: Options) {
    options = next;
    if (!usesHapticOverlay({haptics:next.enabled})) {
      input?.remove(); input = undefined; button.classList.remove('haptic-target'); return;
    }
    if (!input) {
      input = document.createElement('input');
      input.type = 'checkbox'; input.setAttribute('switch','');
      input.setAttribute('aria-hidden','true'); input.tabIndex = -1;
      input.className = 'haptic-overlay';
      input.addEventListener('pointerdown',remember);
      input.addEventListener('mousedown',avoidMouseFocus);
      button.append(input); button.classList.add('haptic-target');
    }
    input.disabled = button.disabled;
  }
  button.addEventListener('click',click,true);
  update(initial);
  return {update,destroy(){button.removeEventListener('click',click,true);input?.remove();button.classList.remove('haptic-target');}};
}
