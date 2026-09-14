/**
 * `hints` coverage for TerminalStep, against the real `useStepChecker`.
 *
 * Lives apart from `terminal-step.test.tsx` because that suite mocks the whole
 * requirements-manager barrel, which would make a hint assertion vacuous.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { TerminalStep } from './terminal-step';

jest.mock('../../integrations/coda/TerminalContext', () => ({
  useTerminalContext: () => ({
    status: 'connected',
    sendCommand: jest.fn(),
    openTerminal: jest.fn(),
    isTerminalRegistered: true,
    vmId: 'test-vm',
  }),
}));

jest.mock('../../integrations/coda/useCodaAvailability.hook', () => ({
  useCodaTerminalGate: () => 'configured',
  useCodaSessionEligibility: () => ({ state: 'eligible' }),
  codaUnavailableMessage: () => null,
  useReportSandboxUnavailable: jest.fn(),
}));

describe('TerminalStep: hints', () => {
  const UNSATISFIABLE_REQUIREMENT = 'on-page:/pathfinder-terminal-never-here';

  it('explains an unmet requirement with the authored hint', async () => {
    render(
      <TerminalStep
        command="ls -la"
        requirements={UNSATISFIABLE_REQUIREMENT}
        hints="Connect the sandbox terminal before running this command."
      />
    );

    expect(await screen.findByText('Connect the sandbox terminal before running this command.')).toBeInTheDocument();
  });

  it('falls back to the generic requirement message when no hint is authored', async () => {
    render(<TerminalStep command="ls -la" requirements={UNSATISFIABLE_REQUIREMENT} />);

    expect(await screen.findByText(/Navigate to the .* page first/)).toBeInTheDocument();
  });
});
