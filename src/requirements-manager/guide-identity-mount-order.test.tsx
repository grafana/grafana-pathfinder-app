/**
 * Regression (#1519): a step's mount-time requirement check must resolve the
 * guide it is mounted under, not whichever guide last touched the window global.
 *
 * `useStepChecker` fires its first check from a child `useEffect`, and child
 * passive effects run before the parent's. A step with `requirements` and no
 * `objectives` leaves no `await` between that effect and the guide-identity
 * read, so the whole race fits in one synchronous turn — this is the only path
 * that reproduces it. The conditional block's initial evaluation is deferred
 * with `setTimeout(…, 0)`, which lands after the entire passive-effect flush
 * and therefore cannot.
 *
 * The false-pass direction is the one that matters: the retry harness only
 * retries failures, so a stale read that unlocks a step returns immediately and
 * never self-heals. These tests assert the step stays locked.
 */

import * as fs from 'fs';
import * as path from 'path';

import React, { useLayoutEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { useStepChecker } from './index';
import { registerGuideId, resetGuideIdentityForTests } from '../global-state/guide-identity';
import { guideResponseStorage } from '../lib/user-storage';

jest.mock('../lib/user-storage', () => ({
  guideResponseStorage: {
    getResponse: jest.fn(),
  },
}));

jest.mock('../global-state/alignment-pending-context', () => ({
  AlignmentPendingContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
  useIsAlignmentPaused: jest.fn(() => false),
  useAlignmentStartingLocation: jest.fn(() => null),
}));

jest.mock('../interactive-engine', () => ({
  useInteractiveElements: jest.fn(() => ({
    checkRequirementsFromData: jest.fn().mockResolvedValue({ pass: true, requirements: '', error: [], canFix: false }),
    fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
  })),
  useSequentialStepState: jest.fn(() => undefined),
  NavigationManager: jest.fn().mockImplementation(() => ({
    expandParentNavigationSection: jest.fn().mockResolvedValue(true),
    fixLocationRequirement: jest.fn().mockResolvedValue(undefined),
    fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
  })),
}));

const mockGetResponse = guideResponseStorage.getResponse as jest.MockedFunction<
  typeof guideResponseStorage.getResponse
>;

/**
 * Mirrors how `ContentRenderer` publishes its derived guide id. The layout
 * effect is the fix under test; the source contract at the bottom of this file
 * pins the renderer to the same shape.
 */
function GuideHost({ guideId, children }: { guideId: string; children: React.ReactNode }) {
  useLayoutEffect(() => registerGuideId(guideId), [guideId]);
  return <>{children}</>;
}

/** A standalone step, so `isFirstStep` is true and the mount check fires. */
function Step({ requirements }: { requirements: string }) {
  const state = useStepChecker({ stepId: 'mount-order-step', requirements, isEligibleForChecking: true });
  const label = state.isEnabled ? 'enabled' : state.isRetrying ? 'retrying' : 'blocked';
  return <div data-testid="step-state">{label}</div>;
}

describe('guide identity at step mount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGuideIdentityForTests();
    mockGetResponse.mockImplementation(async (guideId, variableName) =>
      guideId === 'guide-a' && variableName === 'accepted' ? true : undefined
    );
  });

  afterEach(() => {
    delete (window as any).__DocsPluginGuideId;
  });

  it('does not unlock a step in guide B with an answer stored for guide A', async () => {
    (window as any).__DocsPluginGuideId = 'guide-a';

    render(
      <GuideHost guideId="guide-b">
        <Step requirements="var-accepted:true" />
      </GuideHost>
    );

    await waitFor(() => expect(mockGetResponse).toHaveBeenCalled());
    expect(mockGetResponse.mock.calls[0]).toEqual(['guide-b', 'accepted']);

    // A failed check retries; a stale pass would have returned immediately.
    await waitFor(() => expect(screen.getByTestId('step-state')).toHaveTextContent('retrying'));
    expect(screen.getByTestId('step-state')).not.toHaveTextContent('enabled');
  });

  it('unlocks a step in the guide the answer belongs to', async () => {
    render(
      <GuideHost guideId="guide-a">
        <Step requirements="var-accepted:true" />
      </GuideHost>
    );

    await waitFor(() => expect(screen.getByTestId('step-state')).toHaveTextContent('enabled'));
    expect(mockGetResponse.mock.calls[0]).toEqual(['guide-a', 'accepted']);
  });
});

describe('ContentRenderer guide-identity contract', () => {
  it('publishes the guide id from a layout effect', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../components/content-renderer/content-renderer.tsx'),
      'utf8'
    );
    expect(source).toMatch(/useLayoutEffect\(\s*\(\)\s*=>\s*registerGuideId\(/);
  });
});
