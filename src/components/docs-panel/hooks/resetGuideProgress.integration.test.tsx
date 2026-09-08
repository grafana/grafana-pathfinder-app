import * as React from 'react';
import { act, render, screen } from '@testing-library/react';

import {
  markStepCompleted,
  resetCompletionStoreForTests,
  useStepCompletion,
} from '../../../global-state/completion-store';
import { resetContentKeyForTests, setActiveTabUrl } from '../../../global-state/content-key';
import { StorageKeys } from '../../../lib/storage-keys';
import { resetGuideProgress } from './resetGuideProgress';

const E2E_GUIDE_URL = 'bundled:e2e-test';
const OTHER_GUIDE_URL = 'bundled:other-guide';
const SECTION_ID = 'section-1';
const STEP_ID = 'step-1';

function progressKey(prefix: string, contentKey: string): string {
  return `${prefix}${contentKey}-${SECTION_ID}`;
}

function StepProbe(): React.ReactElement {
  const { completed } = useStepCompletion(STEP_ID, SECTION_ID);
  return <span data-testid="completed">{String(completed)}</span>;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('resetGuideProgress integration', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetCompletionStoreForTests();
    resetContentKeyForTests();
    setActiveTabUrl(E2E_GUIDE_URL);
  });

  afterEach(() => {
    document.cookie = 'pathfinder-e2e-reset=; Max-Age=0; path=/';
    resetCompletionStoreForTests();
    resetContentKeyForTests();
  });

  it('does not carry cached completion into a replacement guide with the same step IDs', async () => {
    const firstGuide = render(<StepProbe />);
    await flushMicrotasks();

    act(() => {
      markStepCompleted(STEP_ID, SECTION_ID, 'manual');
    });
    await flushMicrotasks();
    expect(screen.getByTestId('completed')).toHaveTextContent('true');

    await act(async () => {
      await resetGuideProgress(E2E_GUIDE_URL);
    });
    expect(screen.getByTestId('completed')).toHaveTextContent('false');

    firstGuide.unmount();
    render(<StepProbe />);
    await flushMicrotasks();

    expect(screen.getByTestId('completed')).toHaveTextContent('false');
  });

  it('preserves other guide and application state', async () => {
    const e2eKeys = [
      progressKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, E2E_GUIDE_URL),
      progressKey(StorageKeys.SECTION_COLLAPSE_PREFIX, E2E_GUIDE_URL),
      progressKey(StorageKeys.SECTION_ACKNOWLEDGED_PREFIX, E2E_GUIDE_URL),
      progressKey(StorageKeys.SECTION_DONE_PREFIX, E2E_GUIDE_URL),
    ];
    const otherGuideKey = progressKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, OTHER_GUIDE_URL);
    e2eKeys.forEach((key) => localStorage.setItem(key, JSON.stringify([STEP_ID])));
    localStorage.setItem(otherGuideKey, JSON.stringify([STEP_ID]));
    localStorage.setItem(
      StorageKeys.INTERACTIVE_COMPLETION,
      JSON.stringify({ [E2E_GUIDE_URL]: 100, [OTHER_GUIDE_URL]: 50 })
    );
    localStorage.setItem(StorageKeys.E2E_TEST_GUIDE, '{"title":"Current fixture"}');
    localStorage.setItem('other-application-state', 'preserved');
    sessionStorage.setItem('other-session-state', 'preserved');
    document.cookie = 'pathfinder-e2e-reset=preserved; path=/';
    const input = document.createElement('input');
    input.value = 'preserved';
    document.body.appendChild(input);

    try {
      await resetGuideProgress(E2E_GUIDE_URL);

      e2eKeys.forEach((key) => expect(localStorage.getItem(key)).toBeNull());
      expect(localStorage.getItem(otherGuideKey)).toBe(JSON.stringify([STEP_ID]));
      expect(JSON.parse(localStorage.getItem(StorageKeys.INTERACTIVE_COMPLETION) ?? '{}')).toEqual({
        [OTHER_GUIDE_URL]: 50,
      });
      expect(localStorage.getItem(StorageKeys.E2E_TEST_GUIDE)).toBe('{"title":"Current fixture"}');
      expect(localStorage.getItem('other-application-state')).toBe('preserved');
      expect(sessionStorage.getItem('other-session-state')).toBe('preserved');
      expect(document.cookie).toContain('pathfinder-e2e-reset=preserved');
      expect(input.value).toBe('preserved');
    } finally {
      input.remove();
    }
  });
});
