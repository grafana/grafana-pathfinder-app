/**
 * End-to-end cover for the two guides that actually collide.
 *
 * `bundled:welcome-to-grafana` and `bundled:welcome-to-grafana-cloud` both
 * ship, and in the superseded key shape every record belonging to the second
 * began with the first's identifier. These tests run the real store against
 * the real storage and the real section registry — no key-shape mocks — so
 * they measure what a reader would see in the progress chip.
 */
import * as React from 'react';
import { act, render, screen } from '@testing-library/react';

import {
  getGuideProgress,
  markStepCompleted,
  resetCompletionStoreForTests,
  useStepCompletion,
} from './completion-store';
import { resetContentKeyForTests, setActiveTabUrl } from './content-key';
import { registerSectionSteps, resetRegistry } from './section-registry';
import { StorageKeys, buildVersionedSectionStorageKey } from '../lib/storage-keys';
import { interactiveStepStorage } from '../lib/user-storage';

const SHORT_GUIDE = 'bundled:welcome-to-grafana';
const LONG_GUIDE = 'bundled:welcome-to-grafana-cloud';
const SECTION_ID = 'section-1';

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
  resetRegistry();
  resetCompletionStoreForTests();
  resetContentKeyForTests();
  interactiveStepStorage.invalidateCountCache(SHORT_GUIDE);
  interactiveStepStorage.invalidateCountCache(LONG_GUIDE);
});

describe('guide percentage — prefix-sharing content keys', () => {
  it('reports 0% for a guide whose neighbour holds all the progress', () => {
    seedSteps(LONG_GUIDE, ['step-1', 'step-2', 'step-3', 'step-4']);
    registerSectionSteps(SECTION_ID, 4);

    expect(getGuideProgress(SHORT_GUIDE)).toEqual({ completed: 0, total: 4, percentage: 0 });
    expect(getGuideProgress(LONG_GUIDE)).toEqual({ completed: 4, total: 4, percentage: 100 });
  });

  it('reports each guide own progress when both have some', () => {
    seedSteps(SHORT_GUIDE, ['step-1']);
    seedSteps(LONG_GUIDE, ['step-1', 'step-2', 'step-3', 'step-4']);
    registerSectionSteps(SECTION_ID, 4);

    expect(getGuideProgress(SHORT_GUIDE).percentage).toBe(25);
    expect(getGuideProgress(LONG_GUIDE).percentage).toBe(100);
  });

  it('does not carry a step completed in one guide into the other', async () => {
    registerSectionSteps(SECTION_ID, 2);
    setActiveTabUrl(LONG_GUIDE);
    render(<StepProbe stepId="step-1" />);
    await flushMicrotasks();

    await act(async () => {
      markStepCompleted('step-1', SECTION_ID, 'manual');
      await Promise.resolve();
    });

    expect(screen.getByTestId('step-1')).toHaveTextContent('true');
    interactiveStepStorage.invalidateCountCache(SHORT_GUIDE);
    expect(getGuideProgress(SHORT_GUIDE).completed).toBe(0);
    expect(getGuideProgress(LONG_GUIDE).completed).toBe(1);
  });

  it('shows the neighbour steps as not completed when reading the shorter guide', async () => {
    seedSteps(LONG_GUIDE, ['step-1']);
    registerSectionSteps(SECTION_ID, 1);
    setActiveTabUrl(SHORT_GUIDE);

    render(<StepProbe stepId="step-1" />);
    await flushMicrotasks();

    expect(screen.getByTestId('step-1')).toHaveTextContent('false');
  });
});
