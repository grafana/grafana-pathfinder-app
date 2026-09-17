/**
 * End-to-end cover for the two guides that actually collide.
 *
 * `bundled:welcome-to-grafana` and `bundled:welcome-to-grafana-cloud` both
 * ship, and in the superseded key shape every record belonging to the second
 * began with the first's identifier. These tests run the real store against
 * the real storage — no key-shape mocks — so they measure what a reader
 * would see in the progress chip.
 */
import * as React from 'react';
import { act, render, screen } from '@testing-library/react';

import {
  markStepCompleted,
  peekGuidePercentage,
  resetCompletionStoreForTests,
  useStepCompletion,
} from './completion-store';
import { resetContentKeyForTests, setActiveTabUrl } from './content-key';
import { publishGuideIndex } from './active-guide-index';
import { computeGuideBlockIndex, type CountableBlock } from '../lib/guide-stats';
import { StorageKeys, buildVersionedSectionStorageKey } from '../lib/storage-keys';
import { interactiveStepStorage } from '../lib/user-storage';

const SHORT_GUIDE = 'bundled:welcome-to-grafana';
const LONG_GUIDE = 'bundled:welcome-to-grafana-cloud';
const SECTION_ID = 'section-1';

/** Four "do it" blocks, ids `step-1`..`step-4`, so evidence resolves by author id. */
function fourStepBlocks(): CountableBlock[] {
  return [1, 2, 3, 4].map((n) => ({ type: 'interactive', id: `step-${n}` }));
}

function publishFourStepIndex(contentKey: string): void {
  publishGuideIndex({
    contentKey,
    index: computeGuideBlockIndex(fourStepBlocks()),
    denominatorSource: 'live-pre-inlining',
  });
}

function seedSteps(contentKey: string, stepIds: string[]): void {
  localStorage.setItem(
    buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, contentKey, SECTION_ID),
    JSON.stringify(stepIds)
  );
}

function StepProbe({ stepId }: { stepId: string }): React.ReactElement {
  const { completed } = useStepCompletion(stepId, SECTION_ID);
  return <span data-testid={stepId}>{String(completed)}</span>;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  resetCompletionStoreForTests();
  resetContentKeyForTests();
  interactiveStepStorage.invalidateCountCache(SHORT_GUIDE);
  interactiveStepStorage.invalidateCountCache(LONG_GUIDE);
});

describe('guide percentage — prefix-sharing content keys', () => {
  it('reports 0% for a guide whose neighbour holds all the progress', () => {
    publishFourStepIndex(SHORT_GUIDE);
    publishFourStepIndex(LONG_GUIDE);
    seedSteps(LONG_GUIDE, ['step-1', 'step-2', 'step-3', 'step-4']);

    expect(peekGuidePercentage(SHORT_GUIDE)).toBe(0);
    expect(peekGuidePercentage(LONG_GUIDE)).toBe(100);
  });

  it('reports each guide own progress when both have some', () => {
    publishFourStepIndex(SHORT_GUIDE);
    publishFourStepIndex(LONG_GUIDE);
    seedSteps(SHORT_GUIDE, ['step-1']);
    seedSteps(LONG_GUIDE, ['step-1', 'step-2', 'step-3', 'step-4']);

    expect(peekGuidePercentage(SHORT_GUIDE)).toBe(25);
    expect(peekGuidePercentage(LONG_GUIDE)).toBe(100);
  });

  it('does not carry a step completed in one guide into the other', async () => {
    publishFourStepIndex(SHORT_GUIDE);
    publishFourStepIndex(LONG_GUIDE);
    setActiveTabUrl(LONG_GUIDE);
    render(<StepProbe stepId="step-1" />);
    await flushMicrotasks();

    await act(async () => {
      markStepCompleted('step-1', SECTION_ID, 'manual');
      await Promise.resolve();
    });

    expect(screen.getByTestId('step-1')).toHaveTextContent('true');
    interactiveStepStorage.invalidateCountCache(SHORT_GUIDE);
    expect(peekGuidePercentage(SHORT_GUIDE)).toBe(0);
    expect(peekGuidePercentage(LONG_GUIDE)).toBe(25);
  });

  it('shows the neighbour steps as not completed when reading the shorter guide', async () => {
    publishFourStepIndex(SHORT_GUIDE);
    seedSteps(LONG_GUIDE, ['step-1']);
    setActiveTabUrl(SHORT_GUIDE);

    render(<StepProbe stepId="step-1" />);
    await flushMicrotasks();

    expect(screen.getByTestId('step-1')).toHaveTextContent('false');
  });
});
