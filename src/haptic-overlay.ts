import type { FeedbackSettings } from './keyboard-feedback';

/** iOS needs the user's trusted tap, not a scripted switch/label click. */
export function usesHapticOverlay(
  settings: FeedbackSettings,
  platform = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  return (
    !!settings.haptics &&
    !!platform &&
    typeof platform.vibrate !== 'function' &&
    (/iPhone|iPad|iPod/.test(platform.userAgent) ||
      (platform.platform === 'MacIntel' && platform.maxTouchPoints > 1))
  );
}
/** Keep native switch activation intact through the next task and paint.
 * DOM reconciliation must not move its input while WebKit commits the toggle.
 */
export function createNativeActivationGuard() {
  let pending = 0;
  const mutations = new Set<() => void>();
  const guard = {
    mutate(action: () => void) {
      if (pending) mutations.add(action);
      else action();
    },
    defer(action: () => void, settled: () => void = () => {}) {
      pending++;
      let dispatched = false;
      const dispatch = () => {
        if (dispatched) return;
        dispatched = true;
        try {
          action();
        } finally {
          requestAnimationFrame(() => {
            settled();
            if (--pending === 0) {
              const queued = [...mutations];
              mutations.clear();
              for (const mutation of queued) guard.mutate(mutation);
            }
          });
        }
      };
      // A task runs after the native click dispatch/default activation. rAF is
      // a fallback only if scheduling the task is unavailable, not a second action.
      try {
        setTimeout(dispatch, 0);
      } catch {
        requestAnimationFrame(dispatch);
      }
    },
  };
  return guard;
}
/** A native switch may still click after a swipe; default activation is allowed,
 * but only a short, stationary gesture may dispatch the associated action. */
export function createTapGesture(now = () => performance.now()) {
  let start: { x: number; y: number; time: number } | undefined,
    rejected = false;
  return {
    down(x: number, y: number) {
      start = { x, y, time: now() };
      rejected = false;
    },
    move(x: number, y: number) {
      if (start && Math.hypot(x - start.x, y - start.y) > 10) rejected = true;
    },
    cancel() {
      if (start) rejected = true;
    },
    scroll() {
      if (start) rejected = true;
    },
    accepts() {
      return !rejected && (!start || now() - start.time <= 700);
    },
  };
}

/** Observe without capturing the pointer or blocking native vertical scrolling.
 * Keep scroll observation through click, including scrolls after pointerup. */
export function trackTapGesture(node: HTMLElement, down = () => {}) {
  const gesture = createTapGesture();
  let pointer: number | undefined;
  const move = (event: PointerEvent) => {
    if (event.pointerId === pointer) gesture.move(event.clientX, event.clientY);
  };
  // Only the finger that began on this target may move its gesture.
  const touchMove = (event: TouchEvent) => {
    const touch = [...event.changedTouches].find((touch) => touch.target === node);
    if (touch) gesture.move(touch.clientX, touch.clientY);
  };
  const cancel = (event: PointerEvent) => {
    if (event.pointerId === pointer) gesture.cancel();
  };
  const up = (event: PointerEvent) => move(event);
  const scroll = (event: Event) => {
    if (
      event.target === window ||
      event.target === document ||
      (event.target instanceof Element && event.target.contains(node))
    )
      gesture.scroll();
  };
  const begin = (event: PointerEvent) => {
    pointer = event.pointerId;
    gesture.down(event.clientX, event.clientY);
    down();
  };
  node.addEventListener('pointerdown', begin);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('touchmove', touchMove, { passive: true });
  window.addEventListener('pointerup', up, { passive: true });
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('scroll', scroll, true);
  return {
    accepts: gesture.accepts,
    destroy() {
      node.removeEventListener('pointerdown', begin);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('scroll', scroll, true);
    },
  };
}
type Options = { enabled: boolean };
type Controller = { refresh: () => void; position: () => void; destroy: () => void };
type Scope = {
  activation: ReturnType<typeof createNativeActivationGuard>;
  root: HTMLElement;
  enabled: boolean;
  scan: () => void;
  forget: (button: HTMLButtonElement) => void;
  controls: Map<HTMLButtonElement, Controller>;
};
const scopes = new Set<Scope>();
const scopeFor = (button: HTMLElement) => [...scopes].find((scope) => scope.root.contains(button));

function attach(button: HTMLButtonElement, scope: Scope): Controller {
  let input: HTMLInputElement | undefined,
    activating = false;
  let gesture: ReturnType<typeof trackTapGesture> | undefined;
  let focus: HTMLElement | null = null,
    pressedTimer: ReturnType<typeof setTimeout> | undefined;
  const remember = () => {
    focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const tap = (event: MouseEvent) => {
    // The overlay is a sibling: its own bubbling event must not also activate
    // ancestor actions. Never preventDefault: WebKit must toggle the switch.
    event.stopPropagation();
    if (!input || button.disabled || activating) return;
    const genuineTap = gesture?.accepts() ?? true;
    const switchInput = input,
      previousFocus = focus;
    focus = null;
    activating = true;
    scope.activation.defer(
      () => {
        if (genuineTap && button.isConnected && !button.disabled) button.click(); // Exactly once, including form submit.
        if (
          previousFocus?.isConnected &&
          (document.activeElement === switchInput || document.activeElement === document.body)
        )
          previousFocus.focus({ preventScroll: true });
        // Never leave keyboard/assistive focus on an aria-hidden native switch.
        if (document.activeElement === switchInput) switchInput.blur();
      },
      () => {
        activating = false;
      },
    );
    if (!genuineTap) return;
    button.classList.add('haptic-pressed');
    clearTimeout(pressedTimer);
    pressedTimer = setTimeout(() => button.classList.remove('haptic-pressed'), 150);
  };
  const vibrate = () => {
    if (scope.enabled && !button.disabled && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(8);
      } catch {
        /* Feedback never blocks navigation. */
      }
    }
  };
  button.addEventListener('click', vibrate);
  function removeOverlay() {
    gesture?.destroy();
    gesture = undefined;
    input?.removeEventListener('click', tap);
    input?.remove();
    input = undefined;
    button.classList.remove('haptic-button');
    clearTimeout(pressedTimer);
    button.classList.remove('haptic-pressed');
    focus = null;
  }
  function positionNow() {
    if (!input) return;
    // Keep the Svelte-owned button in place: only its sibling switch is injected.
    // Both share a positioned ancestor, including local scroll/clipping surfaces.
    const box = button.getBoundingClientRect(),
      parent = input.offsetParent as HTMLElement | null;
    // Cover each half-gap with the actual trusted native switch, so a forgiving
    // key hit area still produces one native activation (never a synthetic one).
    const row = button.classList.contains('key') ? button.parentElement : null;
    const rowBox = row?.getBoundingClientRect();
    const halfGap = row ? (parseFloat(getComputedStyle(row).columnGap) || 0) / 2 : 0;
    const keys = row?.querySelectorAll('button.key');
    const left = rowBox
      ? keys?.[0] === button
        ? rowBox.left
        : Math.max(rowBox.left, box.left - halfGap)
      : box.left;
    const right = rowBox
      ? keys?.[keys.length - 1] === button
        ? rowBox.right
        : Math.min(rowBox.right, box.right + halfGap)
      : box.right;
    const origin = parent?.getBoundingClientRect();
    const scaleX = origin && parent!.offsetWidth ? origin.width / parent!.offsetWidth : 1;
    const scaleY = origin && parent!.offsetHeight ? origin.height / parent!.offsetHeight : 1;
    input.style.left = `${origin ? (left - origin.left) / scaleX + parent!.scrollLeft - parent!.clientLeft : left + window.scrollX}px`;
    input.style.top = `${origin ? (box.top - origin.top) / scaleY + parent!.scrollTop - parent!.clientTop : box.top + window.scrollY}px`;
    input.style.width = `${(right - left) / scaleX}px`;
    input.style.height = `${box.height / scaleY}px`;
    const style = getComputedStyle(button);
    input.style.borderRadius = style.borderRadius;
    input.style.zIndex = style.zIndex;
    input.style.display = button.offsetWidth && button.offsetHeight ? 'block' : 'none';
    if (input.disabled !== button.disabled) input.disabled = button.disabled;
  }
  function position() {
    scope.activation.mutate(positionNow);
  }
  function refreshNow() {
    if (!usesHapticOverlay({ haptics: scope.enabled })) {
      if (input) removeOverlay();
      return;
    }
    if (!input && button.parentNode) {
      button.classList.add('haptic-button');
      input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.setAttribute('aria-hidden', 'true');
      input.tabIndex = -1;
      input.className = 'haptic-overlay';
      gesture = trackTapGesture(input, remember);
      input.addEventListener('click', tap);
      button.after(input);
    }
    // Keyed lists may move a button. Move only our switch to follow it again.
    if (input && button.nextElementSibling !== input) button.after(input);
    positionNow();
  }
  function refresh() {
    scope.activation.mutate(refreshNow);
  }
  function destroyNow() {
    button.removeEventListener('click', vibrate);
    removeOverlay();
  }
  return {
    refresh,
    position,
    destroy() {
      scope.activation.mutate(destroyNow);
    },
  };
}

/** Shared button action; on the app root it also covers screen-local buttons.
 * No links or native form controls are registered. One scope owns the preference
 * and each button gets exactly one controller, including dynamically added sheets.
 */
export function hapticOverlay(node: HTMLElement, initial?: Options) {
  if (node instanceof HTMLButtonElement) {
    scopeFor(node)?.scan();
    return {
      destroy() {
        scopeFor(node)?.forget(node);
      },
    };
  }
  const scope: Scope = {
    activation: createNativeActivationGuard(),
    root: node,
    enabled: !!initial?.enabled,
    scan,
    controls: new Map(),
    forget(button) {
      scope.activation.mutate(() => {
        resize.unobserve(button);
        scope.controls.get(button)?.destroy();
        scope.controls.delete(button);
      });
    },
  };
  scopes.add(scope);
  let frame = 0,
    destroyed = false;
  const resize = new ResizeObserver(schedule);
  function scan() {
    scope.activation.mutate(scanNow);
  }
  function scanNow() {
    if (destroyed) return;
    for (const button of scope.controls.keys()) if (!node.contains(button)) scope.forget(button);
    for (const button of node.querySelectorAll('button')) {
      if (!scope.controls.has(button)) {
        scope.controls.set(button, attach(button, scope));
        resize.observe(button);
      }
      scope.controls.get(button)!.refresh();
    }
  }
  function schedule() {
    if (!destroyed && !frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        scan();
      });
  }
  const observer = new MutationObserver(() => {
    scan();
    schedule();
  });
  observer.observe(node, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'class', 'hidden'],
  });
  // Scroll can move an unpositioned scrolling descendant relative to the shared
  // offset parent. In normal layouts offsets remain stable, but refresh anyway.
  node.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  scan();
  return {
    update(next: Options) {
      scope.enabled = !!next.enabled;
      scan();
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      node.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      scopes.delete(scope);
      scope.activation.mutate(() => {
        for (const control of scope.controls.values()) control.destroy();
        scope.controls.clear();
      });
    },
  };
}
