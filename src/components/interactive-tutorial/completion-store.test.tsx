import * as React from 'react';
import { act, render, screen } from '@testing-library/react';

import {
  STANDALONE_SECTION_ID,
  getGuideProgress,
  markStepCompleted,
  resetCompletionStoreForTests,
  resetStep,
  subscribeProgress,
  useStepCompletion,
} from './completion-store';
import { setActiveTabUrl, resetContentKeyForTests } from '../../global-state/content-key';

// In-memory mocks for the persisted-storage layer so tests are hermetic
// and synchronous-where-they-can-be.
const storedCompleted = new Map<string, Set<string>>(); // `${contentKey}-${sectionId}` -> ids
const guidePercentages = new Map<string, number>();

jest.mock('../../lib/user-storage', () => ({
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
    const { interactiveStepStorage } = require('../../lib/user-storage');
    render(<StepProbe stepId="step-1" sectionId="section-x" />);
    await flushMicrotasks();

    act(() => markStepCompleted('step-1', 'section-x', 'manual'));
    const writesAfterFirst = (interactiveStepStorage.setCompleted as jest.Mock).mock.calls.length;

    act(() => markStepCompleted('step-1', 'section-x', 'manual'));
    expect((interactiveStepStorage.setCompleted as jest.Mock).mock.calls.length).toBe(writesAfterFirst);
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
});
