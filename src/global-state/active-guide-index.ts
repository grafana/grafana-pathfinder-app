import type { ActiveConditionalBranch } from '../lib/guide-stats/conditional-progress';
import { bundledTutorialContentKey } from '../lib/bundled-tutorial-identity';
// Freeze pre-inlining positions together with their denominator; migrated tutorials may load a new revision.

import type { ChoiceProgressModel } from '../lib/guide-stats/choice-progress';
import { evaluateChoiceConditions } from '../lib/choice-response';
import type { GuideBlockIndex } from '../lib/guide-stats';

/** Where the frozen denominator came from. Reported in telemetry, never branched on by UI. */
export type ActiveGuideIndexDenominatorSource = 'live-pre-inlining' | 'live-post-inlining-degraded';

export interface ActiveGuideIndex {
  contentKey: string;
  contentRevision?: string;
  index: GuideBlockIndex;
  denominatorSource: ActiveGuideIndexDenominatorSource;
  choiceModel?: ChoiceProgressModel;
  responses?: Readonly<Record<string, unknown>>;
  /** Preview-only completion evidence. Eviction resets it without a storage write. */
  previewChoiceCompletionKeys?: string[];
}

const conditionalBranches = new Map<string, Map<string, ActiveConditionalBranch>>();

export function getGuideConditionalBranches(contentKey: string): ReadonlyMap<string, ActiveConditionalBranch> {
  return conditionalBranches.get(bundledTutorialContentKey(contentKey)) ?? new Map();
}

export function setGuideConditionalBranch(
  contentKey: string,
  id: string,
  branch: ActiveConditionalBranch | undefined
): void {
  contentKey = bundledTutorialContentKey(contentKey);
  const branches = conditionalBranches.get(contentKey) ?? new Map<string, ActiveConditionalBranch>();
  if (branch) {
    branches.set(id, branch);
    conditionalBranches.set(contentKey, branches);
  } else {
    branches.delete(id);
    if (branches.size === 0) {
      conditionalBranches.delete(contentKey);
    }
  }
}

const activeIndexes = new Map<string, ActiveGuideIndex>();
const sectionVisibility = new Map<string, Map<string, boolean | undefined>>();

export function setGuideSectionVisibility(
  contentKey: string,
  sectionId: string,
  visible: boolean | undefined
): boolean {
  contentKey = bundledTutorialContentKey(contentKey);
  let sections = sectionVisibility.get(contentKey);
  if (!sections) {
    sections = new Map();
    sectionVisibility.set(contentKey, sections);
  }
  if (sections.get(sectionId) === visible) {
    return false;
  }
  sections.set(sectionId, visible);
  return true;
}

export function forgetGuideSectionVisibility(contentKey: string, sectionId: string): void {
  contentKey = bundledTutorialContentKey(contentKey);
  const sections = sectionVisibility.get(contentKey);
  sections?.delete(sectionId);
  if (sections?.size === 0) {
    sectionVisibility.delete(contentKey);
  }
}

export function getHiddenGuideSections(contentKey: string): ReadonlySet<string> {
  contentKey = bundledTutorialContentKey(contentKey);
  const model = activeIndexes.get(contentKey)?.choiceModel;
  return new Set(
    model?.positions
      .flatMap((item) => item.visibility)
      .filter((id) => sectionVisibility.get(contentKey)?.get(id) === false)
  );
}

/** Unknown responses or environment gates cannot exclude unfinished content. */
export function isGuideChoiceProgressReady(contentKey: string): boolean {
  contentKey = bundledTutorialContentKey(contentKey);
  const active = activeIndexes.get(contentKey);
  if (!active?.choiceModel) {
    return true;
  }
  if (active.responses === undefined) {
    return false;
  }
  return active.choiceModel.positions.every((item) => {
    const gates = item.visibility.map(
      (id) =>
        evaluateChoiceConditions(active.choiceModel!.sectionConditions[id], active.responses!) ??
        sectionVisibility.get(contentKey)?.get(id)
    );
    // Descendants of a settled hidden section need not mount or report.
    return gates.includes(false) || gates.every((visible) => visible !== undefined);
  });
}

export function setGuideChoiceResponses(
  contentKey: string,
  responses: Readonly<Record<string, unknown>> | undefined
): void {
  contentKey = bundledTutorialContentKey(contentKey);
  const active = activeIndexes.get(contentKey);
  if (active) {
    active.responses = responses;
  }
}

/**
 * Eviction is half a contract: a guide that is still mounted when its index is
 * dropped has no other producer, and its content-load seam has already run —
 * so without a signal it would never publish again and that guide would stop
 * reporting a percentage for the rest of the session. The seam subscribes to
 * this revision and republishes; the index stays frozen per content key
 * between one eviction and the next, because `publishGuideIndex` is
 * idempotent.
 */
const evictionListeners = new Set<() => void>();
let evictionRevision = 0;

function notifyEvicted(): void {
  evictionRevision += 1;
  evictionListeners.forEach((listener) => listener());
}

export function subscribeGuideIndexEvictions(listener: () => void): () => void {
  evictionListeners.add(listener);
  return () => {
    evictionListeners.delete(listener);
  };
}

export function getGuideIndexEvictionRevision(): number {
  return evictionRevision;
}

/** Publication subscribers are notified on first insert for a content key. */
const publicationListeners = new Set<() => void>();
let publicationRevision = 0;

function notifyPublished(): void {
  publicationRevision += 1;
  publicationListeners.forEach((listener) => listener());
}

/** Subscribe to index publications. Returns unsubscribe function. */
export function subscribeGuideIndexPublications(listener: () => void): () => void {
  publicationListeners.add(listener);
  return () => {
    publicationListeners.delete(listener);
  };
}

/** Get current publication revision (for useSyncExternalStore). */
export function getGuideIndexPublicationRevision(): number {
  return publicationRevision;
}

// Shared tutorial keys freeze each authored revision; switching copies can replace the revision.
export function publishGuideIndex(entry: ActiveGuideIndex): void {
  entry = { ...entry, contentKey: bundledTutorialContentKey(entry.contentKey) };
  const previous = activeIndexes.get(entry.contentKey);
  if (previous && (!entry.contentRevision || previous.contentRevision === entry.contentRevision)) {
    return;
  }
  activeIndexes.set(entry.contentKey, entry);
  notifyPublished();
}

export function getGuideIndex(contentKey: string): ActiveGuideIndex | undefined {
  contentKey = bundledTutorialContentKey(contentKey);
  return activeIndexes.get(contentKey);
}

/** Paired with `evictContentCache` — a reset must let the next load recompute a fresh index. */
export function evictGuideIndex(contentKey: string): void {
  contentKey = bundledTutorialContentKey(contentKey);
  conditionalBranches.delete(contentKey);
  if (activeIndexes.delete(contentKey)) {
    notifyEvicted();
  }
}

/** Paired with `evictAllContentCaches` — "Reset all learning progress". */
export function evictAllGuideIndexes(): void {
  conditionalBranches.clear();
  if (activeIndexes.size === 0) {
    return;
  }
  activeIndexes.clear();
  notifyEvicted();
}
