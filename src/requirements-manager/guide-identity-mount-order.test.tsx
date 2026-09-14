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
import { guideResponseStorage, sectionDoneStorage } from '../lib/user-storage';
import {
  getContentKey,
  sanitizeContentKey,
  resetContentKeyForTests,
  setActiveTabUrl,
} from '../global-state/content-key';
import { fetchRawHtml } from '../docs-retrieval/content-fetcher/fetch-raw';
import { sectionCompletedCheck } from './checks/section-completed-check';

jest.mock('../lib/user-storage', () => ({
  guideResponseStorage: {
    getResponse: jest.fn(),
  },
  sectionDoneStorage: {
    set: jest.fn(),
    get: jest.fn(),
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

function ScopedProbe({ postconditions }: { postconditions: boolean }) {
  const scope = useGuideRequirements();
  const check = postconditions ? scope.checkPostconditions : scope.checkRequirements;
  const [passed, setPassed] = useState<boolean>();
  useEffect(() => {
    void check({
      requirements: ['var-accepted:true', 'section-completed:setup'],
      maxRetries: 0,
    }).then((result) => setPassed(result.pass));
  }, [check]);
  return <div data-testid="scope-result">{`${scope.guideId}:${scope.contentKey}:${passed}`}</div>;
}

describe('explicit content scope', () => {
  const getSectionDone = jest.mocked(sectionDoneStorage.get);

  beforeEach(() => {
    jest.clearAllMocks();
    resetContentKeyForTests();
    setActiveTabUrl('bundled:live');
    mockGetResponse.mockResolvedValue(true);
    getSectionDone.mockResolvedValue(null);
  });

  afterEach(() => {
    resetContentKeyForTests();
    resetGuideIdentityForTests();
  });

  it.each([false, true])(
    'binds guide identity and normalized content scope (postconditions: %s)',
    async (postconditions) => {
      const authoredKey = `https://example.com/../guide/${'a'.repeat(220)}`;
      const expectedKey = sanitizeContentKey(authoredKey);
      getSectionDone.mockImplementation(async (key) => (key === expectedKey ? true : null));
      render(
        <GuideRequirementsProvider guideId="guide-owner" contentKey={authoredKey}>
          <ScopedProbe postconditions={postconditions} />
        </GuideRequirementsProvider>
      );
      await waitFor(() =>
        expect(screen.getByTestId('scope-result')).toHaveTextContent(`guide-owner:${expectedKey}:true`)
      );
      expect(mockGetResponse).toHaveBeenCalledWith('guide-owner', 'accepted');
      expect(getSectionDone).toHaveBeenCalledWith(expectedKey, 'section-setup');
      expect(expectedKey).toHaveLength(200);
      expect(expectedKey).not.toContain('..');
    }
  );

  it('reads the section writer namespace after the learning-path content.json ladder', async () => {
    const requestedUrl = 'https://grafana.com/docs/learning-paths/alerting-first-rule/build-query/';
    const contentUrl = new URL('content.json', requestedUrl).href;
    const originalFetch = global.fetch;
    global.fetch = jest.fn(
      async (url) =>
        ({
          ok: true,
          url: String(url),
          headers: new Headers({ 'Content-Type': 'text/html' }),
          text: async () => (String(url) === contentUrl ? '{"id":"guide-owner","blocks":[]}' : '<html>Guide</html>'),
        }) as Response
    );
    try {
      const fetched = await fetchRawHtml(requestedUrl, {});
      expect(fetched.finalUrl).toBe(contentUrl);
      setActiveTabUrl(requestedUrl);
      const writerKey = getContentKey();
      expect(writerKey).not.toBe(sanitizeContentKey(fetched.finalUrl!));
      await sectionDoneStorage.set(writerKey, 'section-setup', true);
      getSectionDone.mockImplementation(async (key) => (key === writerKey ? true : null));

      render(
        <GuideHost guideId="guide-owner">
          <ScopedProbe postconditions={false} />
        </GuideHost>
      );

      await waitFor(() => expect(screen.getByTestId('scope-result')).toHaveTextContent(':true'));
      expect(getSectionDone).toHaveBeenCalledWith(writerKey, 'section-setup');
      expect(sectionDoneStorage.set).toHaveBeenCalledWith(writerKey, 'section-setup', true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('reads remote section completion from the explicit storage scope', async () => {
    getSectionDone.mockImplementation(async (key) => (key === 'bundled:remote' ? true : null));
    expect(await sectionCompletedCheck('section-completed:setup', 'bundled:remote')).toMatchObject({
      pass: true,
      context: { sectionId: 'section-setup', source: 'storage' },
    });
    expect(getSectionDone).toHaveBeenCalledWith('bundled:remote', 'section-setup');
  });

  it.each([
    ['bundled:remote', false],
    ['', false],
    ['bundled:live', false],
    [undefined, true],
  ] as const)('uses the DOM fallback only for the local content scope (%s)', async (contentKey, pass) => {
    render(<div id="section-setup" className="completed" />);
    const result = await sectionCompletedCheck('section-completed:setup', contentKey);
    expect(result.pass).toBe(pass);
    expect(result.context).toMatchObject({ source: pass ? 'dom' : 'none' });
  });
});

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
    expect(source).toContain('<GuideRequirementsProvider guideId={guideId}>');
  });
});
