import type {FeedbackSettings} from './keyboard-feedback';

/** iOS needs the user's trusted tap, not a scripted switch/label click. */
export function usesHapticOverlay(settings: FeedbackSettings, platform = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return !!settings.haptics && !!platform && typeof platform.vibrate !== 'function'
    && (/iPhone|iPad|iPod/.test(platform.userAgent) || (platform.platform === 'MacIntel' && platform.maxTouchPoints > 1));
}
type Options = {enabled: boolean};
type Controller = {refresh: () => void; position: () => void; destroy: () => void};
type Scope = {root: HTMLElement; enabled: boolean; scan: () => void; forget: (button: HTMLButtonElement) => void; controls: Map<HTMLButtonElement, Controller>};
const scopes = new Set<Scope>();
const scopeFor = (button: HTMLElement) => [...scopes].find(scope => scope.root.contains(button));

function attach(button: HTMLButtonElement, scope: Scope): Controller {
  let input: HTMLInputElement | undefined;
  let focus: HTMLElement | null = null, pressedTimer: ReturnType<typeof setTimeout> | undefined;
  const remember = () => { focus = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  const tap = (event: MouseEvent) => {
    // The overlay is a sibling: its own bubbling event must not also activate
    // ancestor actions. Never preventDefault: WebKit must toggle the switch.
    event.stopPropagation();
    if (!input || button.disabled) return;
    const switchInput = input;
    button.classList.add('haptic-pressed');
    clearTimeout(pressedTimer);
    pressedTimer = setTimeout(() => button.classList.remove('haptic-pressed'), 150);
    button.click(); // Exactly one original button action, including form submit.
    if (focus?.isConnected && (document.activeElement === switchInput || document.activeElement === document.body)) focus.focus({preventScroll:true});
    // body (and other non-focusable elements) cannot receive focus(). Never
    // leave keyboard/assistive focus on an aria-hidden native switch.
    if (document.activeElement === switchInput) switchInput.blur();
    focus = null;
  };
  const vibrate = () => {
    if (scope.enabled && !button.disabled && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(8); } catch { /* Feedback never blocks navigation. */ }
    }
  };
  button.addEventListener('click', vibrate);
  function removeOverlay() {
    input?.removeEventListener('pointerdown', remember); input?.removeEventListener('click', tap);
    input?.remove(); input = undefined;
    button.classList.remove('haptic-button');
    clearTimeout(pressedTimer); button.classList.remove('haptic-pressed'); focus = null;
  }
  function position() {
    if (!input) return;
    // Keep the Svelte-owned button in place: only its sibling switch is injected.
    // Both share a positioned ancestor, including local scroll/clipping surfaces.
    const box = button.getBoundingClientRect(), parent = input.offsetParent as HTMLElement | null;
    const origin = parent?.getBoundingClientRect();
    const scaleX = origin && parent!.offsetWidth ? origin.width / parent!.offsetWidth : 1;
    const scaleY = origin && parent!.offsetHeight ? origin.height / parent!.offsetHeight : 1;
    input.style.left = `${origin ? (box.left-origin.left)/scaleX+parent!.scrollLeft-parent!.clientLeft : box.left+window.scrollX}px`;
    input.style.top = `${origin ? (box.top-origin.top)/scaleY+parent!.scrollTop-parent!.clientTop : box.top+window.scrollY}px`;
    input.style.width = `${box.width/scaleX}px`; input.style.height = `${box.height/scaleY}px`;
    const style = getComputedStyle(button);
    input.style.borderRadius = style.borderRadius; input.style.zIndex = style.zIndex;
    input.style.display = button.offsetWidth && button.offsetHeight ? 'block' : 'none';
    if (input.disabled !== button.disabled) input.disabled = button.disabled;
  }
  function refresh() {
    if (!usesHapticOverlay({haptics:scope.enabled})) { if (input) removeOverlay(); return; }
    if (!input && button.parentNode) {
      button.classList.add('haptic-button');
      input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('switch','');
      input.setAttribute('aria-hidden','true'); input.tabIndex = -1; input.className = 'haptic-overlay';
      input.addEventListener('pointerdown',remember); input.addEventListener('click',tap); button.after(input);
    }
    // Keyed lists may move a button. Move only our switch to follow it again.
    if (input && button.nextElementSibling !== input) button.after(input);
    position();
  }
  return {refresh,position,destroy() { button.removeEventListener('click',vibrate); removeOverlay(); }};
}

/** Shared button action; on the app root it also covers screen-local buttons.
 * No links or native form controls are registered. One scope owns the preference
 * and each button gets exactly one controller, including dynamically added sheets.
 */
export function hapticOverlay(node: HTMLElement, initial?: Options) {
  if (node instanceof HTMLButtonElement) {
    scopeFor(node)?.scan();
    return {destroy() { scopeFor(node)?.forget(node); }};
  }
  const scope: Scope = {root:node,enabled:!!initial?.enabled,scan,controls:new Map(),forget(button) { resize.unobserve(button); scope.controls.get(button)?.destroy(); scope.controls.delete(button); }};
  scopes.add(scope);
  let frame = 0, destroyed = false;
  const resize = new ResizeObserver(schedule);
  function scan() {
    if (destroyed) return;
    for (const button of scope.controls.keys()) if (!node.contains(button)) scope.forget(button);
    for (const button of node.querySelectorAll('button')) {
      if (!scope.controls.has(button)) { scope.controls.set(button,attach(button,scope)); resize.observe(button); }
      scope.controls.get(button)!.refresh();
    }
  }
  function schedule() { if (!destroyed && !frame) frame = requestAnimationFrame(() => { frame=0; scan(); }); }
  const observer = new MutationObserver(() => { scan(); schedule(); });
  observer.observe(node,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','class','hidden']});
  // Scroll can move an unpositioned scrolling descendant relative to the shared
  // offset parent. In normal layouts offsets remain stable, but refresh anyway.
  node.addEventListener('scroll',schedule,true); window.addEventListener('resize',schedule);
  scan();
  return {
    update(next: Options) { scope.enabled=!!next.enabled; scan(); },
    destroy() { destroyed=true; observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); node.removeEventListener('scroll',schedule,true); window.removeEventListener('resize',schedule); scopes.delete(scope); for (const control of scope.controls.values()) control.destroy(); scope.controls.clear(); }
  };
}
