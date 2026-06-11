const PATHFINDER_PANEL_SELECTOR = '[data-pathfinder-content="true"]';
const POLL_INTERVAL_MS = 1000;

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
}

export function detectModalActive(): boolean {
  const ourImageModal = document.querySelector('.journey-image-modal');
  if (ourImageModal && isVisible(ourImageModal)) {
    return true;
  }

  const candidates = document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-overlay-container="true"]');
  for (const el of Array.from(candidates)) {
    // Pathfinder's own floating panel is a role="dialog" but is not a native modal.
    if (el.closest(PATHFINDER_PANEL_SELECTOR)) {
      continue;
    }
    if (isVisible(el)) {
      return true;
    }
  }

  return false;
}

let watchCount = 0;
let observer: MutationObserver | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let checkPending = false;
let lastState = false;

function emit(isOpen: boolean): void {
  document.dispatchEvent(new CustomEvent('pathfinder-modal-state-changed', { detail: { isOpen } }));
}

function check(): void {
  const next = detectModalActive();
  if (next !== lastState) {
    lastState = next;
    emit(next);
  }
}

function scheduleCheck(): void {
  if (checkPending) {
    return;
  }
  checkPending = true;
  // Coalesce bursts of mutations into a single check on the next tick.
  setTimeout(() => {
    checkPending = false;
    check();
  }, 0);
}

export function startModalWatch(): void {
  watchCount += 1;
  if (watchCount > 1) {
    return;
  }
  lastState = detectModalActive();
  observer = new MutationObserver(scheduleCheck);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'role', 'aria-hidden', 'aria-modal', 'data-overlay-container'],
  });
  pollTimer = setInterval(check, POLL_INTERVAL_MS);
}

export function stopModalWatch(): void {
  if (watchCount === 0) {
    return;
  }
  watchCount -= 1;
  if (watchCount > 0) {
    return;
  }
  observer?.disconnect();
  observer = null;
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
