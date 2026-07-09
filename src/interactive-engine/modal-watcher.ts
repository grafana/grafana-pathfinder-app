import { isPathfinderContent } from '../lib/dom/pathfinder-content';

const MODAL_SELECTOR = '[role="dialog"], [aria-modal="true"], [data-overlay-container="true"], .journey-image-modal';
const POLL_INTERVAL_MS = 1000;

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
}

/**
 * The single scan behind both modal detection and dodge positioning —
 * sharing it guarantees the two can never disagree on what counts as a
 * visible native modal.
 */
export function getVisibleModalRects(): DOMRect[] {
  const rects: DOMRect[] = [];
  for (const el of Array.from(document.querySelectorAll(MODAL_SELECTOR))) {
    if (isPathfinderContent(el) || !isVisible(el)) {
      continue;
    }
    rects.push(el.getBoundingClientRect());
  }
  return rects;
}

export function detectModalActive(): boolean {
  return getVisibleModalRects().length > 0;
}

let watchCount = 0;
let observer: MutationObserver | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let checkPending = false;
let lastSignature = '';

function signatureOf(rects: DOMRect[]): string {
  return rects
    .map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`)
    .join('|');
}

function emit(isOpen: boolean): void {
  document.dispatchEvent(new CustomEvent('pathfinder-modal-state-changed', { detail: { isOpen } }));
}

function check(): void {
  const rects = getVisibleModalRects();
  const signature = signatureOf(rects);
  // Signature (not boolean) comparison: an open modal that resizes or moves
  // must re-emit so dodge positioning re-runs against the new geometry.
  if (signature !== lastSignature) {
    lastSignature = signature;
    emit(rects.length > 0);
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
  lastSignature = signatureOf(getVisibleModalRects());
  observer = new MutationObserver(scheduleCheck);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'role', 'aria-hidden', 'aria-modal', 'data-overlay-container'],
  });
  // Backstop for geometry changes that mutate no watched attribute
  // (e.g. a modal re-centering itself on window resize).
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
