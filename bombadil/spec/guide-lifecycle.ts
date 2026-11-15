/**
 * Bombadil specification for the guide-lifecycle pilot (issue #2420).
 *
 * Deliberately exports NO Bombadil defaults. The default click/input
 * generators would wander all of Grafana, and the default properties (HTTP
 * 4xx/5xx, error logs) fire on the stubbed 404 write route by design. Every
 * action here is a custom action that touches only the guide lifecycle, and
 * every property is one of the three in docs/developer/BOMBADIL_PILOT.md.
 *
 * Custom-action handlers run inside the page, so each one is self-contained:
 * it cannot close over module-level values, and the storage key names it needs
 * are repeated literally. `harness.pilot.ts` asserts these literals against
 * `src/lib/storage-keys.ts` so they cannot drift silently.
 */

import { actions, always, next, weighted } from '@antithesishq/bombadil';
import { reload } from '@antithesishq/bombadil/browser/defaults/actions';
import { extract, registerCustomAction } from '@antithesishq/bombadil/browser';

const GUIDE_A = 'bombadil-lifecycle-guide-a';
const GUIDE_B = 'bombadil-lifecycle-guide-b';
const GUIDE_PREVIEW = 'bombadil-lifecycle-preview';

// ---------------------------------------------------------------------------
// Bookkeeping the actions leave in sessionStorage (survives reloads and
// same-origin navigations, dies with the tab). The properties read it back so
// they can tell "the reader did something" from "the page did something".
// ---------------------------------------------------------------------------
//   bombadil-evidence-count   incremented by every action that can legitimately
//                             create or raise progress (Do it, Mark complete)
//   bombadil-evidence-guide   content key of the active tab at that moment

const openGuide = registerCustomAction('open-guide', async (_document, window, id: string) => {
  const url = `https://interactive-learning.grafana.net/packages/${id}/content.json`;
  window.location.assign(`/?doc=${encodeURIComponent(url)}`);
});

const openPreview = registerCustomAction('open-preview', async (_document, window, id: string) => {
  const url = `https://interactive-learning.grafana.net/packages/${id}/content.json#pf-pr-bombadil1`;
  window.location.assign(`/?doc=${encodeURIComponent(url)}`);
});

// In-app launch through the same event link interception uses: no page load, so no Grafana reboot.
const switchGuide = registerCustomAction('switch-guide', async (document, _window, id: string, preview: boolean) => {
  const base = `https://interactive-learning.grafana.net/packages/${id}/content.json`;
  document.dispatchEvent(
    new CustomEvent('pathfinder-auto-open-docs', {
      cancelable: true,
      detail: { url: preview ? `${base}#pf-pr-bombadil1` : base, title: id, source: 'link_interception' },
    })
  );
});

const clickTestId = (document: Document, testId: string): boolean => {
  const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!element) {
    return false;
  }
  element.click();
  return true;
};

const doIt = registerCustomAction('do-it', async (document, window) => {
  const step = document.querySelector<HTMLElement>('[data-testid^="interactive-do-it-"]');
  if (!step) {
    return;
  }
  const activeTab = window.localStorage.getItem('grafana-pathfinder-app-active-tab');
  const tabs = JSON.parse(window.localStorage.getItem('grafana-pathfinder-app-tabs') ?? '[]') as Array<{
    id: string;
    baseUrl: string;
  }>;
  const tab = tabs.find((candidate) => `"${candidate.id}"` === activeTab || candidate.id === activeTab);
  window.sessionStorage.setItem('bombadil-evidence-guide', tab?.baseUrl ?? '');
  window.sessionStorage.setItem(
    'bombadil-evidence-count',
    String(Number(window.sessionStorage.getItem('bombadil-evidence-count') ?? '0') + 1)
  );
  step.click();
});

const markComplete = registerCustomAction('mark-complete', async (document, window) => {
  const activeTab = window.localStorage.getItem('grafana-pathfinder-app-active-tab');
  const tabs = JSON.parse(window.localStorage.getItem('grafana-pathfinder-app-tabs') ?? '[]') as Array<{
    id: string;
    baseUrl: string;
  }>;
  const tab = tabs.find((candidate) => `"${candidate.id}"` === activeTab || candidate.id === activeTab);
  if (clickTestId(document, 'mark-complete-button')) {
    window.sessionStorage.setItem('bombadil-evidence-guide', tab?.baseUrl ?? '');
    window.sessionStorage.setItem(
      'bombadil-evidence-count',
      String(Number(window.sessionStorage.getItem('bombadil-evidence-count') ?? '0') + 1)
    );
  }
});

const resetGuide = registerCustomAction('reset-guide', async (document) => {
  clickTestId(document, 'docs-panel-reset-guide-button');
});

const reopenPanel = registerCustomAction('reopen-panel', async (document) => {
  document.querySelector<HTMLElement>('button[aria-label="Help"]')?.click();
});

const closePanel = registerCustomAction('close-panel', async (document) => {
  clickTestId(document, 'docs-panel-close-button');
});

// ---------------------------------------------------------------------------
// Extractors. Everything is read from storage the product itself owns, so the
// properties do not depend on rendered text.
// ---------------------------------------------------------------------------

type StorageView = {
  /** Write-queue items (durable completion facts waiting to send). */
  queueGuideIds: string[];
  /** Guide-attempt records, one key each. */
  attemptKeyCount: number;
  /** Percentage per content key, from the interactive-completion namespace. */
  percentByKey: Record<string, number>;
  evidenceCount: number;
  evidenceGuide: string;
};

const storage = extract((state): StorageView => {
  const local = state.window.localStorage;
  const session = state.window.sessionStorage;
  const queueGuideIds: string[] = [];
  let attemptKeyCount = 0;
  for (let index = 0; index < local.length; index++) {
    const key = local.key(index);
    if (!key) {
      continue;
    }
    if (key.startsWith('grafana-pathfinder-app-completion-write-queue-v2:') && key.includes(':item:')) {
      try {
        const item = JSON.parse(local.getItem(key) ?? '{}') as { body?: { guideId?: string } };
        queueGuideIds.push(item.body?.guideId ?? '');
      } catch {
        queueGuideIds.push('<unparseable>');
      }
    } else if (key.startsWith('grafana-pathfinder-app-guide-attempt-')) {
      attemptKeyCount++;
    }
  }
  let percentByKey: Record<string, number> = {};
  try {
    percentByKey = JSON.parse(local.getItem('grafana-pathfinder-app-interactive-completion') ?? '{}');
  } catch {
    percentByKey = {};
  }
  return {
    queueGuideIds,
    attemptKeyCount,
    percentByKey,
    evidenceCount: Number(session.getItem('bombadil-evidence-count') ?? '0'),
    evidenceGuide: session.getItem('bombadil-evidence-guide') ?? '',
  };
});

const EMPTY_VIEW: StorageView = {
  queueGuideIds: [],
  attemptKeyCount: 0,
  percentByKey: {},
  evidenceCount: 0,
  evidenceGuide: '',
};

const view = (): StorageView => storage.current ?? EMPTY_VIEW;

const shellReady = extract((state) => state.document.querySelector('button[aria-label="Help"]') !== null);

const panelOpen = extract((state) => state.document.querySelector('[data-testid="docs-panel-container"]') !== null);

const doItAvailable = extract((state) => state.document.querySelector('[data-testid^="interactive-do-it-"]') !== null);

const markCompleteAvailable = extract(
  (state) => state.document.querySelector('[data-testid="mark-complete-button"]') !== null
);

// ---------------------------------------------------------------------------
// Properties. Each is written against COMPLETION-MODEL.md, not against the
// implementation: they compare two observable states and never read module
// internals.
// ---------------------------------------------------------------------------

/**
 * P1. A preview never creates a durable completion. The preview guide's id
 * must never appear on a queued completion fact, whatever was done to it.
 */
export const previewNeverCompletesDurably = always(() => !view().queueGuideIds.includes(GUIDE_PREVIEW));

/**
 * P2. Reopening stored progress does not create a fresh activity attempt or
 * completion fact. The durable-record count (queue items + attempt keys) may
 * only rise in a state transition where the reader did something that can earn
 * progress: i.e. the evidence counter moved.
 */
export const reopeningCreatesNothing = always(() => {
  const before = view();
  const beforeRecords = before.queueGuideIds.length + before.attemptKeyCount;
  return next(() => {
    const after = view();
    const afterRecords = after.queueGuideIds.length + after.attemptKeyCount;
    return afterRecords <= beforeRecords || after.evidenceCount > before.evidenceCount;
  });
});

/**
 * P3. Progress from one guide is not credited to another. A stored percentage
 * for a content key may only rise in a transition where the evidence action
 * was performed while that key was the active tab's guide.
 */
export const progressStaysWithItsGuide = always(() => {
  const before = view();
  return next(() => {
    const after = view();
    return Object.entries(after.percentByKey).every(([key, percent]) => {
      const prior = before.percentByKey[key] ?? 0;
      if (percent <= prior) {
        return true;
      }
      return after.evidenceCount > before.evidenceCount && after.evidenceGuide === key;
    });
  });
});

// ---------------------------------------------------------------------------
// Actions. Weighted and bounded: nothing here can leave the guide lifecycle.
// ---------------------------------------------------------------------------

const lifecycle = actions(() => {
  if (!shellReady.current) {
    // Grafana is still booting; any action now would restart the boot and the page would never settle.
    return ['Wait'];
  }
  if (!panelOpen.current) {
    // Panel still loading, or the reader closed it: give the page time, or reopen it from stored tabs.
    return ['Wait', 'Wait', reopenPanel(), reopenPanel(), reopenPanel(), switchGuide(GUIDE_A, false)];
  }
  const reader = [
    ...(doItAvailable.current ? [doIt(), doIt(), doIt()] : []),
    ...(markCompleteAvailable.current ? [markComplete()] : []),
    resetGuide(),
    closePanel(),
  ];
  const switches = [switchGuide(GUIDE_A, false), switchGuide(GUIDE_B, false), switchGuide(GUIDE_PREVIEW, true)];
  // Full page loads stay in the mix, but rarely: each one is a Grafana reboot.
  return [...reader, ...reader, ...switches, ...switches, openGuide(GUIDE_A), 'Wait'];
});

// Reload only with a guide on screen, and rarely: a reload mid-boot restarts Grafana's startup and the page never settles.
export const lifecycleActions = weighted([
  [12, lifecycle],
  [1, reload.when(() => panelOpen.current)],
]);
