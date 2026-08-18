/**
 * Regression (#1574): in two-tab controller mode a step is still owned by a
 * `ContentRenderer`, so its `var-*` tokens must be resolved against that
 * renderer's guide — not shipped to the live tab, which would resolve them
 * against whichever guide that tab happens to have open (or none at all).
 *
 * The controller therefore splits the requirements string: `var-*` stays here
 * and is evaluated through the scoped checker, everything else round-trips, and
 * the two verdicts are ANDed.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { GuideRequirementsProvider, useStepChecker } from './index';
import { InteractiveModeContext } from '../global-state/interactive-mode-context';
import { useControllerChannel } from '../global-state/controller-channel';
import { resetGuideIdentityForTests } from '../global-state/guide-identity';
import { guideResponseStorage, sectionDoneStorage } from '../lib/user-storage';

jest.mock('../lib/user-storage', () => ({
  guideResponseStorage: {
    getResponse: jest.fn(),
  },
  sectionDoneStorage: {
    get: jest.fn(),
  },
}));

jest.mock('../global-state/controller-channel', () => ({
  useControllerChannel: jest.fn(),
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
const mockSectionDoneGet = sectionDoneStorage.get as jest.MockedFunction<typeof sectionDoneStorage.get>;
const mockUseControllerChannel = useControllerChannel as jest.MockedFunction<typeof useControllerChannel>;

const requestRequirementCheck = jest.fn();

function Step({ stepId, requirements }: { stepId: string; requirements: string }) {
  const state = useStepChecker({ stepId, requirements, isEligibleForChecking: true });
  return <div data-testid={stepId}>{state.isEnabled ? 'enabled' : 'blocked'}</div>;
}

function renderController(guideId: string, stepId: string, requirements: string) {
  return render(
    <InteractiveModeContext.Provider value="controller">
      <GuideRequirementsProvider guideId={guideId}>
        <Step stepId={stepId} requirements={requirements} />
      </GuideRequirementsProvider>
    </InteractiveModeContext.Provider>
  );
}

describe('controller mode keeps var-* on the renderer side', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGuideIdentityForTests();
    mockGetResponse.mockImplementation(async (guideId, variableName) =>
      guideId === 'guide-a' && variableName === 'accepted' ? true : undefined
    );
    mockSectionDoneGet.mockResolvedValue(null);
    requestRequirementCheck.mockResolvedValue({ requirements: 'is-admin', pass: true, error: [] });
    mockUseControllerChannel.mockReturnValue({
      post: jest.fn(),
      requestRequirementCheck,
      requestFix: jest.fn(),
      awaitStepComplete: jest.fn(),
      cancelStepComplete: jest.fn(),
      onStepProgress: jest.fn(() => () => undefined),
    });
  });

  it('sends only the non-storage tokens to the live tab', async () => {
    renderController('guide-a', 'controller-split-step', 'var-accepted:true,is-admin');

    await waitFor(() => expect(requestRequirementCheck).toHaveBeenCalled());
    expect(requestRequirementCheck.mock.calls[0]![1]).toBe('is-admin');
    expect(mockGetResponse).toHaveBeenCalledWith('guide-a', 'accepted');
  });

  it('unlocks when the renderer-scoped answer and the live tab both pass', async () => {
    renderController('guide-a', 'controller-pass-step', 'var-accepted:true,is-admin');

    await waitFor(() => expect(screen.getByTestId('controller-pass-step')).toHaveTextContent('enabled'));
  });

  it('stays blocked when the answer belongs to another guide', async () => {
    renderController('guide-b', 'controller-cross-guide-step', 'var-accepted:true,is-admin');

    await waitFor(() => expect(mockGetResponse).toHaveBeenCalledWith('guide-b', 'accepted'));
    expect(screen.getByTestId('controller-cross-guide-step')).toHaveTextContent('blocked');
  });

  it('skips the round-trip when every token is per-guide', async () => {
    renderController('guide-a', 'controller-only-var-step', 'var-accepted:true');

    await waitFor(() => expect(screen.getByTestId('controller-only-var-step')).toHaveTextContent('enabled'));
    expect(requestRequirementCheck).not.toHaveBeenCalled();
  });

  // `section-completed:` resolves `sectionDoneStorage` under the ambient content
  // key and falls back to sections rendered in this tab's DOM — both are the
  // controller's, so the live tab must never be asked.
  it('keeps section-completed on the controller side', async () => {
    mockSectionDoneGet.mockResolvedValue(true);

    renderController('guide-a', 'controller-section-step', 'section-completed:setup,is-admin');

    await waitFor(() => expect(screen.getByTestId('controller-section-step')).toHaveTextContent('enabled'));
    expect(requestRequirementCheck.mock.calls[0]![1]).toBe('is-admin');
    expect(mockSectionDoneGet).toHaveBeenCalledWith(expect.any(String), 'section-setup');
  });

  it('stays blocked when the controller has not completed the section', async () => {
    renderController('guide-a', 'controller-section-blocked-step', 'section-completed:setup,is-admin');

    await waitFor(() => expect(mockSectionDoneGet).toHaveBeenCalled());
    expect(screen.getByTestId('controller-section-blocked-step')).toHaveTextContent('blocked');
  });
});
