/**
 * Regression (#1519): a step's mount-time requirement check must resolve the
 * guide it is mounted under, not whichever guide last registered a
 * compatibility identity.
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

import React, { useEffect, useLayoutEffect, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import {
  GuideRequirementsProvider,
  SequentialRequirementsManager,
  useGuideRequirements,
  useStepChecker,
} from './index';
import { registerCompatibilityGuideId, resetGuideIdentityForTests } from '../global-state/guide-identity';
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
  useLayoutEffect(() => registerCompatibilityGuideId(guideId), [guideId]);
  return <GuideRequirementsProvider guideId={guideId}>{children}</GuideRequirementsProvider>;
}

/** A standalone step, so `isFirstStep` is true and the mount check fires. */
function Step({ stepId, requirements }: { stepId: string; requirements: string }) {
  const state = useStepChecker({ stepId, requirements, isEligibleForChecking: true });
  const label = state.isEnabled ? 'enabled' : state.isRetrying ? 'retrying' : 'blocked';
  return <div data-testid={stepId}>{label}</div>;
}

function PostconditionProbe({ testId, requirements }: { testId: string; requirements: string }) {
  const { checkPostconditions } = useGuideRequirements();
  const [result, setResult] = useState('checking');

  useEffect(() => {
    void checkPostconditions({ requirements, maxRetries: 0 }).then((value) =>
      setResult(value.pass ? 'passed' : 'failed')
    );
  }, [checkPostconditions, requirements]);

  return <div data-testid={testId}>{result}</div>;
}

describe('guide identity at step mount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGuideIdentityForTests();
    mockGetResponse.mockImplementation(async (guideId, variableName) =>
      guideId === 'guide-a' && variableName === 'accepted' ? true : undefined
    );
  });

  // Guide A mounts second, so it owns the top compatibility registration by the
  // time guide B's step fires its passive mount check.
  it('does not unlock a step in guide B with an answer stored for guide A', async () => {
    render(
      <>
        <GuideHost guideId="guide-b">
          <Step stepId="mount-order-step-b" requirements="var-accepted:true" />
        </GuideHost>
        <GuideHost guideId="guide-a">{null}</GuideHost>
      </>
    );

    await waitFor(() => expect(mockGetResponse).toHaveBeenCalled());
    expect(mockGetResponse.mock.calls[0]).toEqual(['guide-b', 'accepted']);

    // A failed check retries; a stale pass would have returned immediately.
    await waitFor(() => expect(screen.getByTestId('mount-order-step-b')).toHaveTextContent('retrying'));
    expect(screen.getByTestId('mount-order-step-b')).not.toHaveTextContent('enabled');
  });

  it('unlocks a step in the guide the answer belongs to', async () => {
    render(
      <GuideHost guideId="guide-a">
        <Step stepId="mount-order-step-a" requirements="var-accepted:true" />
      </GuideHost>
    );

    await waitFor(() => expect(screen.getByTestId('mount-order-step-a')).toHaveTextContent('enabled'));
    expect(mockGetResponse.mock.calls[0]).toEqual(['guide-a', 'accepted']);
  });

  it('keeps simultaneous mount checks scoped to their renderer', async () => {
    mockGetResponse.mockImplementation(async (guideId, variableName) =>
      (guideId === 'guide-a' && variableName === 'answer-a') || (guideId === 'guide-b' && variableName === 'answer-b')
        ? true
        : undefined
    );

    render(
      <>
        <GuideHost guideId="guide-a">
          <Step stepId="simultaneous-step-a" requirements="var-answer-a:true" />
        </GuideHost>
        <GuideHost guideId="guide-b">
          <Step stepId="simultaneous-step-b" requirements="var-answer-b:true" />
        </GuideHost>
      </>
    );

    await waitFor(() => expect(screen.getByTestId('simultaneous-step-a')).toHaveTextContent('enabled'));
    await waitFor(() => expect(screen.getByTestId('simultaneous-step-b')).toHaveTextContent('enabled'));
    expect(mockGetResponse).toHaveBeenCalledWith('guide-a', 'answer-a');
    expect(mockGetResponse).toHaveBeenCalledWith('guide-b', 'answer-b');
  });

  it('keeps simultaneous retry checks scoped to their renderer', async () => {
    mockGetResponse.mockResolvedValue(undefined);

    render(
      <>
        <GuideHost guideId="guide-a">
          <Step stepId="retry-step-a" requirements="var-answer-a:true" />
        </GuideHost>
        <GuideHost guideId="guide-b">
          <Step stepId="retry-step-b" requirements="var-answer-b:true" />
        </GuideHost>
      </>
    );

    await waitFor(() => expect(screen.getByTestId('retry-step-a')).toHaveTextContent('retrying'));
    await waitFor(() => expect(screen.getByTestId('retry-step-b')).toHaveTextContent('retrying'));
    await waitFor(() => expect(mockGetResponse.mock.calls.length).toBeGreaterThanOrEqual(4));

    for (const [guideId, variableName] of mockGetResponse.mock.calls) {
      expect(guideId).toBe(variableName === 'answer-a' ? 'guide-a' : 'guide-b');
    }
  });

  it('keeps simultaneous reactive checks scoped to their renderer', async () => {
    mockGetResponse.mockResolvedValue(true);

    render(
      <>
        <GuideHost guideId="guide-a">
          <Step stepId="reactive-step-a" requirements="var-answer-a:true" />
        </GuideHost>
        <GuideHost guideId="guide-b">
          <Step stepId="reactive-step-b" requirements="var-answer-b:true" />
        </GuideHost>
      </>
    );

    await waitFor(() => expect(screen.getByTestId('reactive-step-a')).toHaveTextContent('enabled'));
    await waitFor(() => expect(screen.getByTestId('reactive-step-b')).toHaveTextContent('enabled'));
    mockGetResponse.mockClear();

    const manager = SequentialRequirementsManager.getInstance();
    manager.triggerStepCheck('reactive-step-a');
    manager.triggerStepCheck('reactive-step-b');

    await waitFor(() => expect(mockGetResponse).toHaveBeenCalledTimes(2));
    expect(mockGetResponse).toHaveBeenCalledWith('guide-a', 'answer-a');
    expect(mockGetResponse).toHaveBeenCalledWith('guide-b', 'answer-b');
  });

  it('keeps simultaneous postcondition checks scoped to their renderer', async () => {
    mockGetResponse.mockImplementation(async (guideId, variableName) =>
      (guideId === 'guide-a' && variableName === 'answer-a') || (guideId === 'guide-b' && variableName === 'answer-b')
        ? true
        : undefined
    );

    render(
      <>
        <GuideHost guideId="guide-a">
          <PostconditionProbe testId="postcondition-a" requirements="var-answer-a:true" />
        </GuideHost>
        <GuideHost guideId="guide-b">
          <PostconditionProbe testId="postcondition-b" requirements="var-answer-b:true" />
        </GuideHost>
      </>
    );

    await waitFor(() => expect(screen.getByTestId('postcondition-a')).toHaveTextContent('passed'));
    await waitFor(() => expect(screen.getByTestId('postcondition-b')).toHaveTextContent('passed'));
    expect(mockGetResponse).toHaveBeenCalledWith('guide-a', 'answer-a');
    expect(mockGetResponse).toHaveBeenCalledWith('guide-b', 'answer-b');
  });
});

describe('ContentRenderer guide-identity contract', () => {
  it('publishes the guide id from a layout effect', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../components/content-renderer/content-renderer.tsx'),
      'utf8'
    );
    expect(source).toMatch(/useLayoutEffect\(\s*\(\)\s*=>\s*registerCompatibilityGuideId\(/);
    expect(source).toMatch(/<GuideRequirementsProvider guideId=\{guideId\}>/);
  });
});
