import * as React from 'react';
import { act, render, screen } from '@testing-library/react';

import {
  markStepCompleted,
  resetCompletionStoreForTests,
  useStepCompletion,
} from '../../../global-state/completion-store';
import { resetContentKeyForTests, setActiveTabUrl } from '../../../global-state/content-key';
import { StorageKeys, buildVersionedSectionStorageKey } from '../../../lib/storage-keys';
import { guideCompletionMarkStorage, milestoneCompletionStorage } from '../../../lib/user-storage';
import { journeyMilestonePercentages } from '../../../docs-retrieval/learning-journey-helpers';
import type { Milestone } from '../../../types/content.types';
import { resetGuideProgress } from './resetGuideProgress';

const E2E_GUIDE_URL = 'bundled:e2e-test';
const OTHER_GUIDE_URL = 'bundled:other-guide';
const SECTION_ID = 'section-1';
const STEP_ID = 'step-1';

function supersededKey(prefix: string, contentKey: string): string {
  return `${prefix}${contentKey}-${SECTION_ID}`;
}

function currentKey(prefix: string, contentKey: string): string {
  return buildVersionedSectionStorageKey(prefix, contentKey, SECTION_ID);
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

  it('brings a marked guide back unmarked, so the reader can mark it again', async () => {
    await guideCompletionMarkStorage.set(E2E_GUIDE_URL, true);
    await guideCompletionMarkStorage.set(OTHER_GUIDE_URL, true);
    await expect(guideCompletionMarkStorage.get(E2E_GUIDE_URL)).resolves.toBe(true);

    await resetGuideProgress(E2E_GUIDE_URL);

    await expect(guideCompletionMarkStorage.get(E2E_GUIDE_URL)).resolves.toBeNull();
    await expect(guideCompletionMarkStorage.get(OTHER_GUIDE_URL)).resolves.toBe(true);
  });

  it('preserves other guide and application state', async () => {
    const supersededOwnKeys = [
      supersededKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, E2E_GUIDE_URL),
      supersededKey(StorageKeys.SECTION_COLLAPSE_PREFIX, E2E_GUIDE_URL),
      supersededKey(StorageKeys.SECTION_ACKNOWLEDGED_PREFIX, E2E_GUIDE_URL),
      supersededKey(StorageKeys.SECTION_DONE_PREFIX, E2E_GUIDE_URL),
    ];
    const otherGuideKey = currentKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, OTHER_GUIDE_URL);
    supersededOwnKeys.forEach((key) => localStorage.setItem(key, JSON.stringify([STEP_ID])));
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

      // A reset addresses only keys in the current shape, so records left in the
      // superseded shape are out of its reach by design. Nothing reads them; the
      // discard sweep removes them on the next page load, not this reset.
      supersededOwnKeys.forEach((key) => expect(localStorage.getItem(key)).toBe(JSON.stringify([STEP_ID])));
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

// Regression (captain-approved fix on PR #1927, "legacy-milestone-backfill
// -resurrects-reset", HIGH): a completion recorded before the #1925
// milestone-storage migration lives only in the legacy
// `milestoneCompletionStorage`. Reading a journey's progress backfills that
// legacy completion into `interactiveCompletionStorage`
// (`backfillLegacyMilestoneCompletion`) — real, load-bearing behavior for
// pre-migration users, not itself the bug. The bug was that resetting that
// SAME milestone only cleared `interactiveCompletionStorage`, leaving the
// legacy record in place, so the very next read backfilled it right back to
// 100% — the reset appeared to work for one paint, then silently reverted.
describe('resetGuideProgress integration — a milestone reset stays reset despite legacy backfill', () => {
  const JOURNEY_BASE = 'https://grafana.com/docs/learning-journeys/demo/';
  const MILESTONE_URL = 'https://grafana.com/docs/learning-journeys/demo/milestone-2/content.json';
  const MILESTONE_SLUG = 'milestone-2';
  const milestone: Milestone = {
    id: MILESTONE_SLUG,
    number: 1,
    title: 'Milestone 2',
    url: MILESTONE_URL,
    isActive: false,
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('does not get resurrected by legacy backfill after being reset', async () => {
    // Pre-migration production data: only the legacy store has this milestone
    // marked complete, exactly like a real learner who finished it before
    // this migration shipped.
    await milestoneCompletionStorage.markCompleted(JOURNEY_BASE, MILESTONE_SLUG);

    // The first read backfills the legacy completion into
    // interactiveCompletionStorage — this is the real, intended behavior, and
    // this assertion pins it so a future change can't silently break the
    // backfill itself while "fixing" the resurrection bug below.
    expect(journeyMilestonePercentages(JOURNEY_BASE, [milestone])[0]!.percent).toBe(100);

    await resetGuideProgress(MILESTONE_URL, { milestoneSlug: MILESTONE_SLUG, journeyBaseUrl: JOURNEY_BASE });

    // Without the fix, the still-populated legacy record would immediately
    // backfill this milestone right back to 100% on this very next read.
    expect(journeyMilestonePercentages(JOURNEY_BASE, [milestone])[0]!.percent).toBe(0);
  });
});
