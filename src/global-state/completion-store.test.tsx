import * as React from 'react';
import { act, render, screen } from '@testing-library/react';

import {
  STANDALONE_SECTION_ID,
  evictAllContentCaches,
  evictContentCache,
  markStepCompleted,
  markStepsCompleted,
  peekGuidePercentage,
  reconcileSection,
  refreshAndNotifyGuideProgress,
  resetCompletionStoreForTests,
  resetSection,
  resetStep,
  resetSteps,
  subscribeProgress,
  useStepCompletion,
} from './completion-store';
import { setActiveTabUrl, resetContentKeyForTests } from './content-key';
import { interactiveCompletionStorage } from '../lib/user-storage';
import { subscribeProgressEvent, type ProgressEventDetail } from './progress-events';
import { publishGuideIndex } from './active-guide-index';
import { computeGuideBlockIndex, type CountableBlock } from '../lib/guide-stats';
import { StorageKeys, buildVersionedContentStorageKey, buildVersionedSectionStorageKey } from '../lib/storage-keys';

/**
 * Publishes a frozen index of `n` generic (non-completable) blocks, with
 * `ids[i]` (if given) as block `i + 1`'s author id — so a test's stored step
 * completions resolve to a real position via `positionsById`.
 */
function publishFlatIndex(contentKey: string, n: number, ids: readonly string[] = []): void {
  const blocks: CountableBlock[] = Array.from({ length: n }, (_, i) => ({
    type: 'markdown',
    ...(ids[i] ? { id: ids[i] } : {}),
  }));
  publishGuideIndex({ contentKey, index: computeGuideBlockIndex(blocks), denominatorSource: 'live-pre-inlining' });
}

/**
 * Publishes an index of sections, each one block, addressed by the RUNTIME
 * section ids an acknowledgement arrives under. Author ids in a guide carry no
 * `section-` prefix — `InteractiveSection` adds it — so the fixture models
 * that split rather than letting the two namespaces coincide.
 */
function publishSectionedIndex(contentKey: string, runtimeSectionIds: readonly string[]): void {
  const blocks: CountableBlock[] = runtimeSectionIds.map((runtimeId) => ({
    type: 'section',
    id: runtimeId.replace(/^section-/, ''),
    blocks: [{ type: 'markdown' }],
  }));
  publishGuideIndex({ contentKey, index: computeGuideBlockIndex(blocks), denominatorSource: 'live-pre-inlining' });
}

// In-memory mocks for the persisted-storage layer so tests are hermetic
// and synchronous-where-they-can-be. Records are addressed by a NUL-joined
// (contentKey, sectionId) pair so no content key can be a prefix of another
// pair's opening — the ambiguity these mocks exist to model away.
const PAIR_SEPARATOR = '\x00';
function pairKey(contentKey: string, sectionId: string): string {
  return `${contentKey}${PAIR_SEPARATOR}${sectionId}`;
}
function belongsTo(pair: string, contentKey: string): boolean {
  return pair.startsWith(`${contentKey}${PAIR_SEPARATOR}`);
}

const storedCompleted = new Map<string, Set<string>>(); // pairKey(contentKey, sectionId) -> ids
const storedAcks = new Map<string, true>(); // pairKey(contentKey, sectionId) -> true
const guidePercentages = new Map<string, number>();
const storedMarks = new Set<string>(); // contentKey

jest.mock('../lib/user-storage', () => ({
  interactiveStepStorage: {
    getCompleted: jest.fn(async (contentKey: string, sectionId: string) => {
      return new Set(storedCompleted.get(pairKey(contentKey, sectionId)) ?? []);
    }),
    setCompleted: jest.fn(async (contentKey: string, sectionId: string, ids: Set<string>) => {
      storedCompleted.set(pairKey(contentKey, sectionId), new Set(ids));
    }),
    clear: jest.fn(async (contentKey: string, sectionId: string) => {
      storedCompleted.delete(pairKey(contentKey, sectionId));
    }),
    countAllCompleted: jest.fn((contentKey: string) => {
      let total = 0;
      for (const [pair, ids] of storedCompleted) {
        if (belongsTo(pair, contentKey)) {
          total += ids.size;
        }
      }
      return total;
    }),
    listAllCompleted: jest.fn((contentKey: string) => {
      const ids: string[] = [];
      for (const [pair, stepIds] of storedCompleted) {
        if (belongsTo(pair, contentKey)) {
          ids.push(...stepIds);
        }
      }
      return ids;
    }),
    // Cross-tab sync invalidates the per-tab numerator cache without
    // touching localStorage. Our in-memory mock has no cache to clear,
    // so this is a no-op stub — present only to satisfy the production
    // store's call site.
    invalidateCountCache: jest.fn(),
  },
  interactiveCompletionStorage: {
    set: jest.fn(async (contentKey: string, percentage: number) => {
      guidePercentages.set(contentKey, percentage);
    }),
  },
  guideCompletionMarkStorage: {
    isMarked: jest.fn((contentKey: string) => storedMarks.has(contentKey)),
  },
  sectionAcknowledgementStorage: {
    countAllAcknowledged: jest.fn((contentKey: string) => {
      let count = 0;
      for (const pair of storedAcks.keys()) {
        if (belongsTo(pair, contentKey)) {
          count++;
        }
      }
      return count;
    }),
    listAllAcknowledged: jest.fn((contentKey: string) => {
      const sectionIds: string[] = [];
      for (const pair of storedAcks.keys()) {
        if (belongsTo(pair, contentKey)) {
          // pairKey is `${contentKey}\x00${sectionId}` — strip the prefix.
          sectionIds.push(pair.slice(contentKey.length + PAIR_SEPARATOR.length));
        }
      }
      return sectionIds;
    }),
  },
}));

const CONTENT_KEY = 'bundled:test-guide';

beforeEach(() => {
  storedCompleted.clear();
  storedAcks.clear();
  guidePercentages.clear();
  storedMarks.clear();
  resetCompletionStoreForTests();
  resetContentKeyForTests();
  setActiveTabUrl(CONTENT_KEY);
});

function StepProbe({ stepId, sectionId }: { stepId: string; sectionId?: string }): React.ReactElement {
  const { completed, reason } = useStepCompletion(stepId, sectionId);
  return (
    <div>
      <span data-testid="completed">{String(completed)}</span>
      <span data-testid="reason">{reason ?? 'null'}</span>
    </div>
  );
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('completion-store', () => {
  it('returns idle entry before hydration completes', () => {
    render(<StepProbe stepId="step-1" sectionId="section-x" />);
    expect(screen.getByTestId('completed').textContent).toBe('false');
    expect(screen.getByTestId('reason').textContent).toBe('null');
  });

  it('hydrates completed steps from storage', async () => {
    storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-1']));
    render(<StepProbe stepId="step-1" sectionId="section-x" />);
    await flushMicrotasks();
    expect(screen.getByTestId('completed').textContent).toBe('true');
    // Reason is not persisted in storage today, so a hydrated entry has reason=null.
    expect(screen.getByTestId('reason').textContent).toBe('null');
  });

  it('marks a step completed and persists to storage', async () => {
    render(<StepProbe stepId="step-1" sectionId="section-x" />);
    await flushMicrotasks();
    act(() => {
      markStepCompleted('step-1', 'section-x', 'manual');
    });
    expect(screen.getByTestId('completed').textContent).toBe('true');
    expect(screen.getByTestId('reason').textContent).toBe('manual');
    expect(storedCompleted.get(pairKey(CONTENT_KEY, 'section-x'))?.has('step-1')).toBe(true);
  });

  it('treats undefined section as standalone', async () => {
    render(<StepProbe stepId="step-1" />);
    await flushMicrotasks();
    act(() => {
      markStepCompleted('step-1', undefined, 'manual');
    });
    expect(storedCompleted.get(pairKey(CONTENT_KEY, STANDALONE_SECTION_ID))?.has('step-1')).toBe(true);
  });

  it('resetStep clears completion and updates persistence', async () => {
    markStepCompleted('step-1', 'section-x', 'manual');
    await flushMicrotasks();
    render(<StepProbe stepId="step-1" sectionId="section-x" />);
    await flushMicrotasks();
    expect(screen.getByTestId('completed').textContent).toBe('true');

    act(() => {
      resetStep('step-1', 'section-x');
    });
    expect(screen.getByTestId('completed').textContent).toBe('false');
    // Empty completion set fully clears the storage entry rather than
    // leaving a `{}` marker — see `persistSection`.
    expect(storedCompleted.has(pairKey(CONTENT_KEY, 'section-x'))).toBe(false);
  });

  it('skips redundant writes when the same step is marked with the same reason twice', async () => {
    const { interactiveStepStorage } = require('../lib/user-storage');
    render(<StepProbe stepId="step-1" sectionId="section-x" />);
    await flushMicrotasks();

    act(() => markStepCompleted('step-1', 'section-x', 'manual'));
    const writesAfterFirst = (interactiveStepStorage.setCompleted as jest.Mock).mock.calls.length;

    act(() => markStepCompleted('step-1', 'section-x', 'manual'));
    expect((interactiveStepStorage.setCompleted as jest.Mock).mock.calls.length).toBe(writesAfterFirst);
  });

  it('overwrites the stored reason when the same step is re-marked with a different reason', async () => {
    // Closes the FSM-vs-store divergence on the skip path: when the
    // FSM reports `markSkipped` after the component already wrote
    // `'manual'`, the store should pick up the new reason so reload
    // / introspection sees the authoritative final state.
    render(<StepProbe stepId="step-1" sectionId="section-x" />);
    await flushMicrotasks();
    act(() => markStepCompleted('step-1', 'section-x', 'manual'));
    expect(screen.getByTestId('reason').textContent).toBe('manual');

    act(() => markStepCompleted('step-1', 'section-x', 'skipped'));
    expect(screen.getByTestId('reason').textContent).toBe('skipped');
  });

  it('does not relabel a skipped step as one the user completed', async () => {
    // A skipping step writes `'skipped'` through the checker's bridge, and its
    // section then reports the same step complete with the generic `'manual'`.
    // Taking that second write would tell the user their skipped check passed.
    render(<StepProbe stepId="step-1" sectionId="section-x" />);
    await flushMicrotasks();
    act(() => markStepCompleted('step-1', 'section-x', 'skipped'));

    act(() => markStepCompleted('step-1', 'section-x', 'manual'));
    expect(screen.getByTestId('reason').textContent).toBe('skipped');

    // A reset clears the entry, so the next genuine pass is recorded plainly.
    act(() => resetStep('step-1', 'section-x'));
    act(() => markStepCompleted('step-1', 'section-x', 'manual'));
    expect(screen.getByTestId('reason').textContent).toBe('manual');
  });

  it('peekGuidePercentage returns 0% when no frozen index has published for this content key', () => {
    expect(peekGuidePercentage(CONTENT_KEY)).toBe(0);
  });

  // F-1 (#909 follow-up): all-passive guides have no interactive steps, so
  // the percentage must derive from section-ack evidence against the
  // frozen index's section containers, not a step-count division.
  describe('all-passive guide progress (F-1)', () => {
    it('returns 100% once every registered section is acknowledged', () => {
      publishSectionedIndex(CONTENT_KEY, ['section-passive']);
      storedAcks.set(pairKey(CONTENT_KEY, 'section-passive'), true);
      expect(peekGuidePercentage(CONTENT_KEY)).toBe(100);
    });

    it('returns a partial percentage for multi-section guides with one ack', () => {
      publishSectionedIndex(CONTENT_KEY, ['section-1', 'section-2', 'section-3', 'section-4']);
      storedAcks.set(pairKey(CONTENT_KEY, 'section-1'), true);
      expect(peekGuidePercentage(CONTENT_KEY)).toBe(25);
    });

    it('returns 0% when no sections are acknowledged yet', () => {
      publishSectionedIndex(CONTENT_KEY, ['section-1', 'section-2', 'section-3']);
      expect(peekGuidePercentage(CONTENT_KEY)).toBe(0);
    });

    it('returns 0% when no sections are registered yet (guide not mounted)', () => {
      expect(peekGuidePercentage(CONTENT_KEY)).toBe(0);
    });

    it('refreshAndNotifyGuideProgress persists the percentage to interactiveCompletionStorage', () => {
      publishSectionedIndex(CONTENT_KEY, ['section-1', 'section-2']);
      storedAcks.set(pairKey(CONTENT_KEY, 'section-1'), true);
      storedAcks.set(pairKey(CONTENT_KEY, 'section-2'), true);

      refreshAndNotifyGuideProgress(CONTENT_KEY);

      expect(guidePercentages.get(CONTENT_KEY)).toBe(100);
    });
  });

  // A1 — the Mark complete control's mark is authoritative for the guide
  // percentage, so every reader of it agrees and a later step write cannot
  // move a marked guide back down.
  describe('a marked guide', () => {
    it('reports 100% with no steps completed at all', () => {
      publishFlatIndex(CONTENT_KEY, 3);
      storedMarks.add(CONTENT_KEY);

      expect(peekGuidePercentage(CONTENT_KEY)).toBe(100);
    });

    it('reports 100% for a prose-only guide, before any frozen index has even published', () => {
      // The mark is checked before the index lookup, so it is authoritative
      // even independent of whether this content key's guide has loaded.
      storedMarks.add(CONTENT_KEY);

      expect(peekGuidePercentage(CONTENT_KEY)).toBe(100);
    });

    it('stays at 100% for every reader after a later step completion', async () => {
      publishFlatIndex(CONTENT_KEY, 3, ['step-1']);
      storedMarks.add(CONTENT_KEY);
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      await flushMicrotasks();

      act(() => {
        markStepCompleted('step-1', 'section-x', 'manual');
      });

      expect(peekGuidePercentage(CONTENT_KEY)).toBe(100);
      // The persisted percentage is what the recommendation card reads.
      expect(guidePercentages.get(CONTENT_KEY)).toBe(100);
    });

    it('stays at 100% after an all-passive ack recomputes the percentage', () => {
      publishSectionedIndex(CONTENT_KEY, ['section-1', 'section-2', 'section-3']);
      storedAcks.set(pairKey(CONTENT_KEY, 'section-1'), true);
      storedMarks.add(CONTENT_KEY);

      act(() => {
        refreshAndNotifyGuideProgress(CONTENT_KEY);
      });

      expect(peekGuidePercentage(CONTENT_KEY)).toBe(100);
      expect(guidePercentages.get(CONTENT_KEY)).toBe(100);
    });

    it('still reports 100% once the in-memory caches are gone and the guide reloads', () => {
      publishFlatIndex(CONTENT_KEY, 3);
      storedMarks.add(CONTENT_KEY);

      evictAllContentCaches();
      resetCompletionStoreForTests();
      // A reload remounts ContentRenderer, which republishes the frozen
      // index before anything reads the percentage — the mark itself
      // (checked here, unconditionally) needs no index at all, but a
      // guide WITH one still needs it republished after eviction.
      publishFlatIndex(CONTENT_KEY, 3);

      expect(peekGuidePercentage(CONTENT_KEY)).toBe(100);
    });

    it('counts nothing, because the mark settles the answer before any storage scan', () => {
      // `peekGuidePercentage` is a `useSyncExternalStore` snapshot, so it runs
      // on every render of the Mark complete footer; `countAllAcknowledged`
      // is an uncached scan over the whole of localStorage.
      const { interactiveStepStorage, sectionAcknowledgementStorage } = jest.requireMock('../lib/user-storage');
      publishSectionedIndex(CONTENT_KEY, ['section-1', 'section-2', 'section-3']);
      storedMarks.add(CONTENT_KEY);
      interactiveStepStorage.countAllCompleted.mockClear();
      interactiveStepStorage.listAllCompleted.mockClear();
      sectionAcknowledgementStorage.countAllAcknowledged.mockClear();
      sectionAcknowledgementStorage.listAllAcknowledged.mockClear();

      expect(peekGuidePercentage(CONTENT_KEY)).toBe(100);

      expect(sectionAcknowledgementStorage.listAllAcknowledged).not.toHaveBeenCalled();
      expect(interactiveStepStorage.listAllCompleted).not.toHaveBeenCalled();
    });

    it('drops back to the derived percentage once the mark is cleared', () => {
      publishFlatIndex(CONTENT_KEY, 4, ['step-1']);
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-1']));
      storedMarks.add(CONTENT_KEY);
      expect(peekGuidePercentage(CONTENT_KEY)).toBe(100);

      storedMarks.delete(CONTENT_KEY);

      expect(peekGuidePercentage(CONTENT_KEY)).toBe(25);
    });
  });

  it('peekGuidePercentage computes percentage when the frozen index is known', () => {
    publishFlatIndex(CONTENT_KEY, 4, ['step-1', 'step-2']);
    storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-1', 'step-2']));
    expect(peekGuidePercentage(CONTENT_KEY)).toBe(50);
  });

  it('subscribeProgress fires when steps are marked completed', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeProgress(CONTENT_KEY, listener);
    act(() => markStepCompleted('step-1', 'section-x', 'manual'));
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  describe('hydration race', () => {
    it('does not resurrect a step the user reset while hydration was in flight', async () => {
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-1', 'step-2']));
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      // Reset BEFORE hydration's microtask runs — this is the race window.
      act(() => {
        resetStep('step-1', 'section-x');
      });
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('false');
      // The unrelated step the user did not reset should still hydrate.
      const { rerender } = render(<StepProbe stepId="step-2" sectionId="section-x" />);
      void rerender;
      await flushMicrotasks();
      // Storage now reflects the post-reset state — step-1 cleared, step-2 kept.
      expect(storedCompleted.get(pairKey(CONTENT_KEY, 'section-x'))).toEqual(new Set(['step-2']));
    });

    it('drops the entire snapshot when resetSection runs during hydration', async () => {
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-1', 'step-2']));
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      act(() => {
        resetSection('section-x');
      });
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('false');
      expect(storedCompleted.has(pairKey(CONTENT_KEY, 'section-x'))).toBe(false);
    });

    it('honours resetSteps tail-clear across the hydration boundary', async () => {
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-1', 'step-2', 'step-3']));
      render(<StepProbe stepId="step-2" sectionId="section-x" />);
      act(() => {
        resetSteps(['step-2', 'step-3'], 'section-x');
      });
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('false');
      expect(storedCompleted.get(pairKey(CONTENT_KEY, 'section-x'))).toEqual(new Set(['step-1']));
    });

    it('mark issued during pending hydration survives the resolve', async () => {
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-a']));
      render(<StepProbe stepId="step-b" sectionId="section-x" />);
      // Hydration pending.
      act(() => markStepCompleted('step-b', 'section-x', 'manual'));
      await flushMicrotasks();
      expect(storedCompleted.get(pairKey(CONTENT_KEY, 'section-x'))).toEqual(new Set(['step-a', 'step-b']));
    });
  });

  describe('bulk progress events', () => {
    function captureStepEvents(): { events: ProgressEventDetail[]; unsubscribe: () => void } {
      const events: ProgressEventDetail[] = [];
      const unsubscribe = subscribeProgressEvent((detail) => {
        if (detail.kind === 'step') {
          events.push(detail);
        }
      });
      return { events, unsubscribe };
    }

    it('markStepsCompleted dispatches per-step completion events for newly completed steps', () => {
      const { events, unsubscribe } = captureStepEvents();
      act(() => {
        markStepsCompleted(['s-1', 's-2', 's-3'], 'section-x', 'objectives');
      });
      expect(events).toHaveLength(3);
      expect(events).toEqual([
        { kind: 'step', stepId: 's-1', sectionId: 'section-x', completed: true, reason: 'objectives' },
        { kind: 'step', stepId: 's-2', sectionId: 'section-x', completed: true, reason: 'objectives' },
        { kind: 'step', stepId: 's-3', sectionId: 'section-x', completed: true, reason: 'objectives' },
      ]);
      unsubscribe();
    });

    it('markStepsCompleted skips events for already-completed steps', () => {
      act(() => {
        markStepsCompleted(['s-1'], 'section-x', 'manual');
      });
      const { events, unsubscribe } = captureStepEvents();
      act(() => {
        markStepsCompleted(['s-1', 's-2'], 'section-x', 'objectives');
      });
      expect(events).toEqual([
        { kind: 'step', stepId: 's-2', sectionId: 'section-x', completed: true, reason: 'objectives' },
      ]);
      unsubscribe();
    });

    // The rollup surfaces (a path mean, a journey mean) do not recompute the
    // percentage — they re-read the persisted one when the store announces it.
    // A reset-only write moves that number just as a completion does.
    it('announces the percentage a step reset lowered, not only one a completion raised', async () => {
      publishFlatIndex(CONTENT_KEY, 4, ['a1', 'a2', 'b1']);
      act(() => {
        markStepsCompleted(['a1', 'a2'], 'section-a', 'manual');
        markStepCompleted('b1', 'section-b', 'manual');
      });
      await flushMicrotasks();
      expect(guidePercentages.get(CONTENT_KEY)).toBe(75);

      const announced: ProgressEventDetail[] = [];
      const unsubscribe = subscribeProgressEvent((detail) => {
        if (detail.kind === 'guide') {
          announced.push(detail);
        }
      });
      act(() => {
        resetSteps(['b1'], 'section-b');
      });
      await flushMicrotasks();
      unsubscribe();

      expect(guidePercentages.get(CONTENT_KEY)).toBe(50);
      expect(announced.map((detail) => detail.kind === 'guide' && detail.percentage)).toEqual([50]);
    });

    it('announces only after the percentage it reports has been persisted', async () => {
      publishFlatIndex(CONTENT_KEY, 2, ['s-1', 's-2']);
      // The real record is read before it is rewritten, so the write lands a
      // microtask after the call — model that, or the gap is invisible here.
      (interactiveCompletionStorage.set as jest.Mock).mockImplementationOnce(
        async (contentKey: string, percentage: number) => {
          await Promise.resolve();
          guidePercentages.set(contentKey, percentage);
        }
      );
      const seenAtAnnouncement: Array<number | undefined> = [];
      const unsubscribe = subscribeProgressEvent((detail) => {
        if (detail.kind === 'guide') {
          seenAtAnnouncement.push(guidePercentages.get(CONTENT_KEY));
        }
      });

      act(() => {
        markStepCompleted('s-1', 'section-a', 'manual');
      });
      await flushMicrotasks();
      unsubscribe();

      // A subscriber that reads the record on notification must not see the
      // value this write replaced.
      expect(seenAtAnnouncement).toEqual([50]);
    });

    it('resetSteps dispatches per-step reset events for actually-cleared steps', async () => {
      act(() => {
        markStepsCompleted(['s-1', 's-2', 's-3'], 'section-x', 'manual');
      });
      const { events, unsubscribe } = captureStepEvents();
      act(() => {
        resetSteps(['s-2', 's-3', 's-never-completed'], 'section-x');
      });
      // Only the steps that were actually deleted from the cache should fire.
      expect(events.map((e) => e.kind === 'step' && e.stepId)).toEqual(['s-2', 's-3']);
      expect(events.every((e) => e.kind === 'step' && e.completed === false)).toBe(true);
      unsubscribe();
    });

    it('resetSection dispatches per-step reset events for each previously completed step', () => {
      act(() => {
        markStepsCompleted(['s-1', 's-2'], 'section-x', 'manual');
      });
      const { events, unsubscribe } = captureStepEvents();
      act(() => {
        resetSection('section-x');
      });
      expect(new Set(events.map((e) => e.kind === 'step' && e.stepId))).toEqual(new Set(['s-1', 's-2']));
      expect(events.every((e) => e.kind === 'step' && e.completed === false)).toBe(true);
      unsubscribe();
    });
  });

  // Reset guide / "Reset progress" parity tripwire.
  //
  // Storage-clear paths (`useContentReset`, `useGuidePreviewProgress.reset`,
  // `MyLearningTab.handleResetAll`) used to leave the completion store's
  // in-memory cache populated — the next render would resurrect "completed"
  // until the component remounted. `evictContentCache` /
  // `evictAllContentCaches` close that gap.
  describe('cache eviction parity with clearAllForContent / clearAll', () => {
    it('evictContentCache flips subscribers back to not-completed', async () => {
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      act(() => markStepCompleted('step-1', 'section-x', 'manual'));
      expect(screen.getByTestId('completed').textContent).toBe('true');

      act(() => evictContentCache(CONTENT_KEY));
      expect(screen.getByTestId('completed').textContent).toBe('false');
    });

    it('evictContentCache lets a fresh hydration repopulate from storage', async () => {
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-1']));
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('true');

      // Storage cleared elsewhere — caller then evicts the cache. We
      // simulate that order here.
      storedCompleted.delete(pairKey(CONTENT_KEY, 'section-x'));
      act(() => evictContentCache(CONTENT_KEY));
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('false');
    });

    it('evictContentCache scoped to one key does not affect other content keys', () => {
      // Set up two separate "guides" via two render trees on the same probe component;
      // the store keys off the active content key, so we mutate it between writes.
      act(() => markStepCompleted('step-a', 'section-a', 'manual'));
      setActiveTabUrl(`${CONTENT_KEY}-other`);
      act(() => markStepCompleted('step-b', 'section-b', 'manual'));
      setActiveTabUrl(CONTENT_KEY);

      act(() => evictContentCache(CONTENT_KEY));

      // The OTHER guide still has its storage entry — make sure the
      // cache for it wasn't touched.
      setActiveTabUrl(`${CONTENT_KEY}-other`);
      const { getByTestId } = render(<StepProbe stepId="step-b" sectionId="section-b" />);
      expect(getByTestId('completed').textContent).toBe('true');
    });

    it('evictAllContentCaches flips subscribers across every active key', () => {
      const { rerender, getByTestId, unmount } = render(<StepProbe stepId="step-1" sectionId="section-x" />);
      act(() => markStepCompleted('step-1', 'section-x', 'manual'));
      expect(getByTestId('completed').textContent).toBe('true');
      void rerender;

      act(() => evictAllContentCaches());
      expect(getByTestId('completed').textContent).toBe('false');
      unmount();
    });

    // MF-4 / N-1 — race between in-flight hydration and a synchronous
    // evictContentCache. The earlier test on line 309 awaits microtasks
    // BEFORE evicting, so hydration completes first and the race window
    // is never opened. This test exercises the window: storage read
    // pending, user clicks Reset, evict fires, then the storage promise
    // resolves with the (now-stale) snapshot. Without the bail guard in
    // ensureHydrated.then the stale IDs are silently re-inserted and the
    // UI flips back to "completed".
    it('evictContentCache during in-flight hydration does not resurrect snapshot', async () => {
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-1', 'step-2']));
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      act(() => {
        storedCompleted.delete(pairKey(CONTENT_KEY, 'section-x'));
        evictContentCache(CONTENT_KEY);
      });
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('false');
    });
  });

  // MF-2 — roster reconciliation + the frozen-index clamp.
  //
  // Stable step IDs (MF-1) make storage durable across renames, so
  // editing a guide can leave orphan IDs in localStorage that the
  // guide's current frozen index doesn't recognise (no matching
  // position). Without reconciliation, storage keeps accumulating
  // orphans; `guideProgressAtPosition`'s own clamp keeps a
  // position-mismatch from ever reading over 100% regardless. The
  // pair:
  //   - `reconcileSection` drops orphans from storage on first mount.
  //   - unmatched evidence resolves to position 0 rather than
  //     inflating anything, and the position clamp covers the rest.
  describe('roster reconciliation + percentage clamp', () => {
    it('reconcileSection drops storage IDs not present in the roster', async () => {
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-a', 'step-b', 'orphan']));
      render(<StepProbe stepId="step-a" sectionId="section-x" />);
      await flushMicrotasks();
      act(() => {
        reconcileSection('section-x', ['step-a', 'step-b']);
      });
      await flushMicrotasks();
      const stored = storedCompleted.get(pairKey(CONTENT_KEY, 'section-x'));
      expect(stored).toBeDefined();
      expect(stored!.has('orphan')).toBe(false);
      expect(stored!.has('step-a')).toBe(true);
      expect(stored!.has('step-b')).toBe(true);
    });

    it('reconcileSection is a no-op when storage matches the roster', async () => {
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-a']));
      render(<StepProbe stepId="step-a" sectionId="section-x" />);
      await flushMicrotasks();
      const persistSpy = jest.spyOn(storedCompleted, 'set');
      act(() => {
        reconcileSection('section-x', ['step-a']);
      });
      // No write — set was not called again for this section.
      expect(persistSpy.mock.calls.some((call) => call[0] === pairKey(CONTENT_KEY, 'section-x'))).toBe(false);
      persistSpy.mockRestore();
    });

    it('does not exceed 100% when storage holds orphan IDs the frozen index has no position for', () => {
      // Storage has 5 IDs across two sections; the index only knows s1-s3.
      // s4/s5 are orphans (e.g. from a since-edited guide) and evidence
      // nothing — the position clamp keeps this from reading over 100%.
      publishFlatIndex(CONTENT_KEY, 3, ['s1', 's2', 's3']);
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['s1', 's2', 's3']));
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-y'), new Set(['s4', 's5']));
      expect(peekGuidePercentage(CONTENT_KEY)).toBe(100);
    });
  });

  // N-2 — cross-tab progress corruption.
  //
  // localStorage is shared across browser tabs but the store's caches
  // live per-tab. Before the storage listener, tab B's stale cache
  // could silently write back over tab A's authoritative reset (or
  // vice versa). The listener evicts the affected section's cache +
  // bumps its hydration version, then notifies subscribers so the
  // next render re-hydrates from authoritative storage.
  //
  // Tests dispatch synthetic StorageEvents (jsdom doesn't fire them
  // for in-tab localStorage writes — and even if it did, the spec
  // only fires them in OTHER tabs).
  describe('cross-tab sync', () => {
    it('evicts the in-memory section cache when another tab writes to localStorage', async () => {
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      act(() => markStepCompleted('step-1', 'section-x', 'manual'));
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('true');

      // Simulate tab A clearing its progress: localStorage now holds
      // an empty set for our section, and the storage event fires in
      // tab B (this test runner). Our listener should evict the cache.
      storedCompleted.delete(pairKey(CONTENT_KEY, 'section-x'));
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, CONTENT_KEY, 'section-x'),
            newValue: '[]',
            oldValue: '["step-1"]',
          })
        );
      });
      await flushMicrotasks();
      // Subscriber re-reads authoritative storage on the next render
      // and sees the empty set.
      expect(screen.getByTestId('completed').textContent).toBe('false');
    });

    it('ignores storage events for unrelated localStorage keys', async () => {
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      act(() => markStepCompleted('step-1', 'section-x', 'manual'));
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('true');

      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'some-other-app-key',
            newValue: 'irrelevant',
          })
        );
      });

      // Cache untouched — subscriber still sees the completion.
      expect(screen.getByTestId('completed').textContent).toBe('true');
    });

    it('treats event.key === null (localStorage.clear from another tab) as a global evict', async () => {
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      act(() => markStepCompleted('step-1', 'section-x', 'manual'));
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('true');

      // Simulate tab A calling `localStorage.clear()` — browsers fire
      // a `storage` event with key=null in OTHER tabs to signal a
      // full storage wipe.
      storedCompleted.clear();
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: null }));
      });
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('false');
    });

    it('matches exact (contentKey, sectionId) — does not misroute when one content key is a prefix of another', async () => {
      // Regression for the prefix-collision bug in the original
      // listener: when one active content key (`bundled:loki-101`)
      // is a hyphen-delimited string prefix of another
      // (`bundled:loki-101-extended`), `stripped.startsWith(short + '-')`
      // matched the shorter key first and evicted the wrong pair,
      // leaving the longer guide's cache stale until the next mount.
      // The key shape now marks the boundary, and the listener still
      // compares whole keys rather than parsing them.
      const SHORT_KEY = 'bundled:loki-101';
      const LONG_KEY = 'bundled:loki-101-extended';

      setActiveTabUrl(SHORT_KEY);
      storedCompleted.set(pairKey(SHORT_KEY, 'section-x'), new Set(['step-1']));
      const short = render(<StepProbe stepId="step-1" sectionId="section-x" />);
      await flushMicrotasks();
      expect(short.getByTestId('completed').textContent).toBe('true');
      short.unmount();

      setActiveTabUrl(LONG_KEY);
      storedCompleted.set(pairKey(LONG_KEY, 'section-y'), new Set(['step-2']));
      const long = render(<StepProbe stepId="step-2" sectionId="section-y" />);
      await flushMicrotasks();
      expect(long.getByTestId('completed').textContent).toBe('true');

      // Tab A clears LONG_KEY's progress; storage event fires here for
      // the LONG key only. Exact matching evicts the LONG pair; prefix
      // matching would have evicted a non-existent `(SHORT_KEY, "extended-section-y")`
      // and left the LONG cache untouched.
      storedCompleted.delete(pairKey(LONG_KEY, 'section-y'));
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, LONG_KEY, 'section-y'),
            newValue: null,
            oldValue: '["step-2"]',
          })
        );
      });
      await flushMicrotasks();
      expect(long.getByTestId('completed').textContent).toBe('false');
      long.unmount();

      // SHORT_KEY cache must still hold its completion — the exact-match
      // path never touched it.
      setActiveTabUrl(SHORT_KEY);
      const shortAgain = render(<StepProbe stepId="step-1" sectionId="section-x" />);
      expect(shortAgain.getByTestId('completed').textContent).toBe('true');
      shortAgain.unmount();
    });

    // A1 — the mark namespace became authoritative for the guide percentage,
    // so a mark another tab writes has to reach this tab's subscribers.
    it('notifies subscribers when another tab writes a completion mark', () => {
      const listener = jest.fn();
      subscribeProgress(CONTENT_KEY, listener);

      storedMarks.add(CONTENT_KEY);
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: buildVersionedContentStorageKey(StorageKeys.GUIDE_COMPLETION_MARK_PREFIX, CONTENT_KEY),
            newValue: 'true',
            oldValue: null,
          })
        );
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(peekGuidePercentage(CONTENT_KEY)).toBe(100);
    });

    it('spares a sibling guide whose key merely starts with the written one', () => {
      const listener = jest.fn();
      subscribeProgress(CONTENT_KEY, listener);

      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: buildVersionedContentStorageKey(StorageKeys.GUIDE_COMPLETION_MARK_PREFIX, `${CONTENT_KEY}-extended`),
            newValue: 'true',
            oldValue: null,
          })
        );
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('ignores a mark left in the superseded shape, which #1864 discarded', () => {
      const listener = jest.fn();
      subscribeProgress(CONTENT_KEY, listener);

      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: `${StorageKeys.GUIDE_COMPLETION_MARK_PREFIX}${CONTENT_KEY}`,
            newValue: 'true',
            oldValue: null,
          })
        );
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('ignores the timestamp sibling the hybrid storage writes beside each mark', () => {
      const listener = jest.fn();
      subscribeProgress(CONTENT_KEY, listener);

      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: `${buildVersionedContentStorageKey(StorageKeys.GUIDE_COMPLETION_MARK_PREFIX, CONTENT_KEY)}__timestamp`,
            newValue: '1757000000000',
            oldValue: null,
          })
        );
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('drops stale in-flight hydration when a cross-tab storage event triggers re-hydration', async () => {
      // Race scenario: tab B's `ensureHydrated` has scheduled a storage
      // read with snapshot `{step-1, step-2}`. Tab A clears its progress
      // BEFORE that read resolves. The storage event fires in tab B
      // (evicts cache + bumps hydration version), the subscriber
      // re-renders and starts a fresh hydration cycle. The original
      // in-flight `.then` then resolves — without the version check it
      // would merge `{step-1, step-2}` back into the now-empty cache,
      // silently undoing tab A's clear.
      storedCompleted.set(pairKey(CONTENT_KEY, 'section-x'), new Set(['step-1', 'step-2']));
      render(<StepProbe stepId="step-2" sectionId="section-x" />);
      // Hydration pending — do NOT flush yet. The original `.then` is
      // queued with `expectedVersion = 0`.
      storedCompleted.delete(pairKey(CONTENT_KEY, 'section-x'));
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, CONTENT_KEY, 'section-x'),
            newValue: null,
            oldValue: '["step-1","step-2"]',
          })
        );
      });
      await flushMicrotasks();
      // The fresh re-hydration reads the now-empty storage; the stale
      // in-flight read drops its merge on resolve. Subscriber stays at
      // not-completed.
      expect(screen.getByTestId('completed').textContent).toBe('false');
    });
  });
});
