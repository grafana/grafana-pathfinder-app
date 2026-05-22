import * as React from 'react';
import { act, render, screen } from '@testing-library/react';

import {
  STANDALONE_SECTION_ID,
  evictAllContentCaches,
  evictContentCache,
  getGuideProgress,
  markStepCompleted,
  markStepsCompleted,
  resetCompletionStoreForTests,
  resetSection,
  resetStep,
  resetSteps,
  subscribeProgress,
  useStepCompletion,
} from './completion-store';
import { setActiveTabUrl, resetContentKeyForTests } from './content-key';
import { subscribeProgressEvent, type ProgressEventDetail } from './progress-events';

// In-memory mocks for the persisted-storage layer so tests are hermetic
// and synchronous-where-they-can-be.
const storedCompleted = new Map<string, Set<string>>(); // `${contentKey}-${sectionId}` -> ids
const guidePercentages = new Map<string, number>();

jest.mock('../lib/user-storage', () => ({
  interactiveStepStorage: {
    getCompleted: jest.fn(async (contentKey: string, sectionId: string) => {
      return new Set(storedCompleted.get(`${contentKey}-${sectionId}`) ?? []);
    }),
    setCompleted: jest.fn(async (contentKey: string, sectionId: string, ids: Set<string>) => {
      storedCompleted.set(`${contentKey}-${sectionId}`, new Set(ids));
    }),
    clear: jest.fn(async (contentKey: string, sectionId: string) => {
      storedCompleted.delete(`${contentKey}-${sectionId}`);
    }),
    countAllCompleted: jest.fn((contentKey: string) => {
      let total = 0;
      storedCompleted.forEach((ids, key) => {
        if (key.startsWith(`${contentKey}-`)) {
          total += ids.size;
        }
      });
      return total;
    }),
  },
  interactiveCompletionStorage: {
    set: jest.fn(async (contentKey: string, percentage: number) => {
      guidePercentages.set(contentKey, percentage);
    }),
  },
}));

let mockTotalDocumentSteps = 0;
jest.mock('./section-registry', () => ({
  getTotalDocumentSteps: () => mockTotalDocumentSteps,
}));

const CONTENT_KEY = 'bundled:test-guide';

beforeEach(() => {
  storedCompleted.clear();
  guidePercentages.clear();
  mockTotalDocumentSteps = 0;
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
    storedCompleted.set(`${CONTENT_KEY}-section-x`, new Set(['step-1']));
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
    expect(storedCompleted.get(`${CONTENT_KEY}-section-x`)?.has('step-1')).toBe(true);
  });

  it('treats undefined section as standalone', async () => {
    render(<StepProbe stepId="step-1" />);
    await flushMicrotasks();
    act(() => {
      markStepCompleted('step-1', undefined, 'manual');
    });
    expect(storedCompleted.get(`${CONTENT_KEY}-${STANDALONE_SECTION_ID}`)?.has('step-1')).toBe(true);
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
    expect(storedCompleted.has(`${CONTENT_KEY}-section-x`)).toBe(false);
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

  it('getGuideProgress returns 0% when total steps is unknown', () => {
    storedCompleted.set(`${CONTENT_KEY}-section-x`, new Set(['step-1']));
    mockTotalDocumentSteps = 0;
    expect(getGuideProgress(CONTENT_KEY)).toEqual({ completed: 1, total: 0, percentage: 0 });
  });

  it('getGuideProgress computes percentage when total steps is known', () => {
    storedCompleted.set(`${CONTENT_KEY}-section-x`, new Set(['step-1', 'step-2']));
    mockTotalDocumentSteps = 4;
    expect(getGuideProgress(CONTENT_KEY)).toEqual({ completed: 2, total: 4, percentage: 50 });
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
      storedCompleted.set(`${CONTENT_KEY}-section-x`, new Set(['step-1', 'step-2']));
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
      expect(storedCompleted.get(`${CONTENT_KEY}-section-x`)).toEqual(new Set(['step-2']));
    });

    it('drops the entire snapshot when resetSection runs during hydration', async () => {
      storedCompleted.set(`${CONTENT_KEY}-section-x`, new Set(['step-1', 'step-2']));
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      act(() => {
        resetSection('section-x');
      });
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('false');
      expect(storedCompleted.has(`${CONTENT_KEY}-section-x`)).toBe(false);
    });

    it('honours resetSteps tail-clear across the hydration boundary', async () => {
      storedCompleted.set(`${CONTENT_KEY}-section-x`, new Set(['step-1', 'step-2', 'step-3']));
      render(<StepProbe stepId="step-2" sectionId="section-x" />);
      act(() => {
        resetSteps(['step-2', 'step-3'], 'section-x');
      });
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('false');
      expect(storedCompleted.get(`${CONTENT_KEY}-section-x`)).toEqual(new Set(['step-1']));
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
      storedCompleted.set(`${CONTENT_KEY}-section-x`, new Set(['step-1']));
      render(<StepProbe stepId="step-1" sectionId="section-x" />);
      await flushMicrotasks();
      expect(screen.getByTestId('completed').textContent).toBe('true');

      // Storage cleared elsewhere — caller then evicts the cache. We
      // simulate that order here.
      storedCompleted.delete(`${CONTENT_KEY}-section-x`);
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
  });
});
