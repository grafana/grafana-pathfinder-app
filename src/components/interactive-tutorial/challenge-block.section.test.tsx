/**
 * Section-level regression test: a challenge placed after an incomplete
 * sibling step must render the sequential-block state, not Start challenge.
 *
 * The section, requirements checker, and completion store are all real here —
 * only the sandbox/terminal layer and the section runner engine are mocked.
 * That keeps the eligibility derivation (`computeStepEligibility`), the
 * checker's `SET_BLOCKED` path, and the block's gating honest end to end.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import { InteractiveQuiz } from './interactive-quiz';
import { ChallengeBlock } from './challenge-block';
import { useTerminalContext } from '../../integrations/coda/TerminalContext';
import { useCodaSessionEligibility, useCodaTerminalGate } from '../../integrations/coda/useCodaAvailability.hook';

jest.mock('../../integrations/coda/TerminalContext', () => ({
  useTerminalContext: jest.fn(),
}));

jest.mock('../../integrations/coda/useCodaAvailability.hook', () => ({
  ...jest.requireActual('../../integrations/coda/useCodaAvailability.hook'),
  useCodaTerminalGate: jest.fn(),
  useCodaSessionEligibility: jest.fn(),
}));

jest.mock('../../integrations/coda/coda-api', () => ({
  ...jest.requireActual('../../integrations/coda/coda-api'),
  execInSession: jest.fn(),
}));

jest.mock('../../interactive-engine', () => ({
  useInteractiveElements: () => ({
    executeInteractiveAction: jest.fn(),
    startSectionBlocking: jest.fn(),
    stopSectionBlocking: jest.fn(),
    verifyStepResult: jest.fn(async () => true),
    checkRequirementsFromData: jest.fn(async () => ({ passed: true })),
    fixNavigationRequirements: jest.fn(async () => undefined),
    fixLocationRequirement: jest.fn(async () => undefined),
    expandParentNavigationSection: jest.fn(async () => undefined),
    clearAllHighlights: jest.fn(),
  }),
  NavigationManager: jest.fn().mockImplementation(() => ({
    clearAllHighlights: jest.fn(),
    fixNavigationRequirements: jest.fn(async () => undefined),
    fixLocationRequirement: jest.fn(async () => undefined),
    expandParentNavigationSection: jest.fn(async () => undefined),
  })),
  useSequentialStepState: () => undefined,
  ActionMonitor: {
    getInstance: () => ({
      enable: jest.fn(),
      forceEnable: jest.fn(),
      forceDisable: jest.fn(),
    }),
  },
  outcomeFromLoopExit: jest.fn((reason: unknown) => reason),
}));

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { StepAutoCompleted: 'auto' },
  buildInteractiveStepProperties: jest.fn((props: unknown) => props),
}));

jest.mock('../../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
  setFaroUserActionAttributes: jest.fn(),
  USER_ACTION_TIMEOUT_LONG_MS: 600000,
}));

const mockedUseTerminalContext = useTerminalContext as jest.MockedFunction<typeof useTerminalContext>;
const mockedUseCodaTerminalGate = useCodaTerminalGate as jest.MockedFunction<typeof useCodaTerminalGate>;
const mockedUseCodaSessionEligibility = useCodaSessionEligibility as jest.MockedFunction<
  typeof useCodaSessionEligibility
>;

beforeEach(() => {
  jest.clearAllMocks();
  resetInteractiveCounters();
  mockedUseCodaTerminalGate.mockReturnValue('configured');
  mockedUseCodaSessionEligibility.mockReturnValue({ state: 'eligible' });
  mockedUseTerminalContext.mockReturnValue({
    status: 'disconnected',
    sessionId: null,
    error: null,
    isTerminalRegistered: true,
    connect: jest.fn(),
    disconnect: jest.fn(),
    sendCommand: jest.fn(),
    openTerminal: jest.fn(),
    isExpanded: false,
    setIsExpanded: jest.fn(),
    _register: jest.fn(),
  });
});

describe('ChallengeBlock sequential blocking at section level', () => {
  it('renders Complete previous step instead of Start challenge after an incomplete quiz', async () => {
    render(
      <InteractiveSection id="sec-blocked" title="Blocked section" autoCollapse={false}>
        <InteractiveQuiz
          stepId="quiz-1"
          question="What is 2 + 2?"
          choices={[
            { id: 'a', text: '3', correct: false },
            { id: 'b', text: '4', correct: true },
          ]}
          shuffle={false}
        >
          What is 2 + 2?
        </InteractiveQuiz>
        <ChallengeBlock
          stepId="challenge-2"
          title="Fix the broken scrape"
          brief="Alloy is misconfigured. Restore metric collection."
          successCriteria="has-dashboard-named:My Dashboard"
        />
      </InteractiveSection>
    );

    expect(await screen.findByText('Complete previous step')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start challenge/i })).not.toBeInTheDocument();
  });
});
