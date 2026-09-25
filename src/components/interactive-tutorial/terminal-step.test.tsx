/**
 * Tests for the TerminalStep component.
 */

import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TerminalStep } from './terminal-step';
import { testIds } from '../../constants/testIds';
import { markStepCompleted } from '../../global-state/completion-store';

// Mock Grafana UI components
jest.mock('@grafana/ui', () => ({
  Button: ({ children, onClick, disabled, tooltip, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} title={tooltip} {...rest}>
      {children}
    </button>
  ),
  Icon: ({ name }: any) => <span data-testid={`icon-${name}`} />,
  useStyles2: () => ({
    disabled: '',
    content: '',
    commandBlock: '',
    actions: '',
    completedBadge: '',
    requirementMessage: '',
    copyFeedback: '',
  }),
}));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

// The real module pulls @grafana/runtime in, and that reaches into @grafana/ui
// internals this suite's partial mock does not carry.
const mockReportAppInteraction = jest.fn();
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: (...args: unknown[]) => mockReportAppInteraction(...args),
  UserInteraction: { DoItButtonClick: 'do_it_button_click' },
  buildInteractiveStepProperties: jest.fn((props: unknown) => props),
}));

const mockCheckerResetStep = jest.fn();
let mockCheckerOverrides: { isEnabled?: boolean; isChecking?: boolean; explanation?: string; canSkip?: boolean } = {};
jest.mock('../../requirements-manager', () => ({
  useStepChecker: ({ isEligibleForChecking }: { isEligibleForChecking: boolean }) => ({
    isEnabled: isEligibleForChecking,
    isChecking: false,
    explanation: isEligibleForChecking ? null : 'Complete previous step',
    canSkip: false,
    resetStep: (...args: unknown[]) => mockCheckerResetStep(...args),
    ...mockCheckerOverrides,
  }),
  validateInteractiveRequirements: jest.fn(),
}));

// Mock the completion store (unit tests don't drive persistence here)
const mockResetStep = jest.fn();
jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: jest.fn(() => ({ completed: false, reason: null })),
  markStepCompleted: jest.fn(),
  resetStep: (...args: unknown[]) => mockResetStep(...args),
  STANDALONE_SECTION_ID: '__standalone__',
}));

// Mock TerminalContext
const mockSendCommand = jest.fn().mockResolvedValue(undefined);
const mockOpenTerminal = jest.fn();
let mockTerminalStatus = 'connected';
let mockIsTerminalRegistered = true;

jest.mock('../../integrations/coda/TerminalContext', () => ({
  useTerminalContext: () => ({
    status: mockTerminalStatus,
    sendCommand: mockSendCommand,
    openTerminal: mockOpenTerminal,
    isTerminalRegistered: mockIsTerminalRegistered,
    vmId: 'test-vm',
  }),
}));

// The real hook reaches @grafana/runtime and the Coda SDK, neither of which this
// suite's partial @grafana/ui mock can satisfy. Only the verdict matters here.
let mockSandboxUnavailable: string | null = null;
const mockReportSandboxUnavailable = jest.fn();

jest.mock('../../integrations/coda/useCodaAvailability.hook', () => ({
  useCodaTerminalGate: () => 'configured',
  useCodaSessionEligibility: () => ({ state: 'eligible' }),
  codaUnavailableMessage: () => mockSandboxUnavailable,
  useReportSandboxUnavailable: (...args: unknown[]) => mockReportSandboxUnavailable(...args),
}));

// Mock clipboard
const mockWriteText = jest.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: { writeText: mockWriteText },
});

describe('TerminalStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTerminalStatus = 'connected';
    mockIsTerminalRegistered = true;
    mockSandboxUnavailable = null;
    mockCheckerOverrides = {};
  });

  // The provider mounts even when the panel that owns `connect` is gated away,
  // so an ungated Connect button is a control wired to nothing.
  it('states why there is no Exec button when the sandbox is unavailable, and still offers Copy', () => {
    mockTerminalStatus = 'disconnected';
    mockIsTerminalRegistered = false;
    mockSandboxUnavailable =
      'This step runs its command in a Coda sandbox VM, and the sandbox terminal is not available here.';

    render(<TerminalStep command="ls -la" />);

    expect(screen.getByText(mockSandboxUnavailable)).toBeInTheDocument();
    expect(screen.queryByText('Connect terminal')).not.toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('offers Connect terminal when the sandbox is available but not yet connected', () => {
    mockTerminalStatus = 'disconnected';

    render(<TerminalStep command="ls -la" />);

    expect(screen.getByText('Connect terminal')).toBeInTheDocument();
  });

  it('exposes connection and execution controls without treating Copy as Exec', async () => {
    render(<TerminalStep stepId="contract-command" command="echo hello" />);
    const root = screen.getByTestId(testIds.interactive.terminalStep('contract-command'));
    expect(root).toHaveAttribute('data-test-terminal-status', 'connected');
    expect(root).toHaveAttribute('data-test-terminal-unavailable', 'false');
    fireEvent.click(screen.getByTestId(testIds.interactive.terminalExecButton('contract-command')));
    await waitFor(() => expect(markStepCompleted).toHaveBeenCalledWith('contract-command', undefined, 'manual'));
    expect(mockSendCommand).toHaveBeenCalledWith('echo hello');
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it('exposes dispatch errors without completing and clears the error on retry', async () => {
    mockSendCommand.mockRejectedValueOnce(new Error('Disconnected'));
    render(<TerminalStep stepId="dispatch-error" command="echo hello" />);
    const exec = screen.getByTestId(testIds.interactive.terminalExecButton('dispatch-error'));
    fireEvent.click(exec);
    const error = await screen.findByTestId(testIds.interactive.errorMessage('dispatch-error'));
    expect(error).toHaveTextContent('The command could not be sent');
    expect(screen.getByTestId(testIds.interactive.terminalStep('dispatch-error'))).toHaveAttribute(
      'data-test-step-state',
      'error'
    );
    expect(markStepCompleted).not.toHaveBeenCalled();
    fireEvent.click(exec);
    await waitFor(() => expect(markStepCompleted).toHaveBeenCalled());
    expect(screen.queryByTestId(testIds.interactive.errorMessage('dispatch-error'))).not.toBeInTheDocument();
  });

  it('exposes the unavailable prerequisite while retaining Copy for human use', () => {
    mockTerminalStatus = 'disconnected';
    mockSandboxUnavailable = 'The Coda plugin is missing.';
    render(<TerminalStep stepId="missing-coda" command="echo hello" />);
    expect(screen.getByTestId(testIds.interactive.terminalStep('missing-coda'))).toHaveAttribute(
      'data-test-terminal-unavailable',
      'true'
    );
    expect(screen.getByTestId(testIds.interactive.requirementCheck('missing-coda'))).toHaveTextContent(
      mockSandboxUnavailable
    );
    expect(screen.getByTestId(testIds.interactive.terminalCopyButton('missing-coda'))).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.interactive.terminalConnectButton('missing-coda'))).not.toBeInTheDocument();
  });

  it.each([false, true])('offers unavailable-Coda Skip only when authored skippable=%s', (skippable) => {
    mockTerminalStatus = 'disconnected';
    mockSandboxUnavailable = 'The Coda plugin is missing.';
    render(<TerminalStep stepId="optional-unavailable" command="echo hello" skippable={skippable} />);

    expect(screen.getByTestId(testIds.interactive.terminalStep('optional-unavailable'))).toHaveAttribute(
      'data-test-skippable',
      String(skippable)
    );
    const skip = screen.queryByTestId(testIds.interactive.terminalSkipButton('optional-unavailable'));
    if (skippable) {
      expect(skip).toBeVisible();
      fireEvent.click(skip!);
      expect(markStepCompleted).toHaveBeenCalledWith('optional-unavailable', undefined, 'manual');
    } else {
      expect(skip).not.toBeInTheDocument();
      expect(markStepCompleted).not.toHaveBeenCalled();
    }
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(mockOpenTerminal).not.toHaveBeenCalled();
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it('does not offer Skip while a preceding step is incomplete', () => {
    render(<TerminalStep stepId="blocked" command="echo hello" skippable isEligibleForChecking={false} />);
    expect(screen.getByText('Complete previous step')).toBeVisible();
    expect(screen.queryByTestId(testIds.interactive.terminalSkipButton('blocked'))).not.toBeInTheDocument();
    expect(markStepCompleted).not.toHaveBeenCalled();
  });

  it('offers prerequisite Skip only when the checker permits it', () => {
    mockCheckerOverrides = { isEnabled: false, explanation: 'Missing prerequisite', canSkip: true };
    render(<TerminalStep stepId="unmet" command="echo hello" skippable />);
    fireEvent.click(screen.getByTestId(testIds.interactive.terminalSkipButton('unmet')));
    expect(markStepCompleted).toHaveBeenCalledWith('unmet', undefined, 'manual');
  });

  it('limits shared connection errors to eligible steps without duplicating the panel alert', () => {
    mockTerminalStatus = 'error';
    render(
      <>
        <TerminalStep stepId="current" command="echo current" />
        <TerminalStep stepId="blocked" command="echo blocked" isEligibleForChecking={false} />
      </>
    );
    expect(screen.getByTestId(testIds.interactive.terminalStep('current'))).toHaveAttribute(
      'data-test-step-state',
      'error'
    );
    expect(screen.getByTestId(testIds.interactive.terminalStep('blocked'))).toHaveAttribute(
      'data-test-step-state',
      'requirements-unmet'
    );
    expect(screen.queryByTestId(testIds.interactive.errorMessage('blocked'))).not.toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactive.errorMessage('current'))).toBeVisible();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('leaves the alert to the terminal panel when a dispatch error coincides with a connection error', async () => {
    mockSendCommand.mockRejectedValueOnce(new Error('Connection lost'));
    const { rerender } = render(<TerminalStep stepId="dispatch" command="echo hello" />);
    fireEvent.click(screen.getByTestId(testIds.interactive.terminalExecButton('dispatch')));
    await screen.findByRole('alert');
    mockTerminalStatus = 'error';
    rerender(<TerminalStep stepId="dispatch" command="echo hello" />);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByTestId(testIds.interactive.errorMessage('dispatch'))).toBeVisible();
  });

  it('preserves checking state during a shared connection error', () => {
    mockTerminalStatus = 'error';
    mockCheckerOverrides = { isChecking: true };
    render(<TerminalStep stepId="checking" command="echo hello" />);
    expect(screen.getByTestId(testIds.interactive.terminalStep('checking'))).toHaveAttribute(
      'data-test-step-state',
      'checking'
    );
    expect(screen.queryByTestId(testIds.interactive.errorMessage('checking'))).not.toBeInTheDocument();
  });

  it('renders command and description', () => {
    render(
      <TerminalStep command="echo hello">
        <p>Run this command</p>
      </TerminalStep>
    );

    expect(screen.getByText('echo hello')).toBeInTheDocument();
    expect(screen.getByText('Run this command')).toBeInTheDocument();
  });

  it('shows Copy and Exec buttons when terminal is connected', () => {
    render(<TerminalStep command="ls -la" />);

    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Exec')).toBeInTheDocument();
  });

  it('shows Connect terminal button when terminal is disconnected', () => {
    mockTerminalStatus = 'disconnected';

    render(<TerminalStep command="ls -la" />);

    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Connect terminal')).toBeInTheDocument();
  });

  it('copies command to clipboard when Copy is clicked', async () => {
    render(<TerminalStep command="echo hello" />);

    fireEvent.click(screen.getByText('Copy'));

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith('echo hello');
    });
    expect(mockReportAppInteraction).toHaveBeenCalledWith(
      'do_it_button_click',
      expect.objectContaining({ interaction_location: 'terminal_step', completion_method: 'copy' })
    );
  });

  it('sends command to terminal when Exec is clicked', async () => {
    render(<TerminalStep command="echo hello" />);

    fireEvent.click(screen.getByText('Exec'));

    await waitFor(() => {
      expect(mockSendCommand).toHaveBeenCalledWith('echo hello');
    });
    expect(mockReportAppInteraction).toHaveBeenCalledWith(
      'do_it_button_click',
      expect.objectContaining({ interaction_location: 'terminal_step', completion_method: 'exec' })
    );
  });

  it('calls openTerminal when Connect terminal is clicked', () => {
    mockTerminalStatus = 'disconnected';

    render(<TerminalStep command="ls" />);

    fireEvent.click(screen.getByText('Connect terminal'));

    expect(mockOpenTerminal).toHaveBeenCalled();
  });

  it('does not render inline step position (numbering handled by CSS counter)', () => {
    render(<TerminalStep command="ls" stepIndex={0} totalSteps={3} />);

    expect(screen.queryByText('Step 1 of 3')).not.toBeInTheDocument();
  });

  describe('a section reset', () => {
    it('suppresses its own store write, since the section already wrote one', () => {
      const { rerender } = render(
        <TerminalStep command="ls" stepId="t-1" onStepComplete={jest.fn()} resetTrigger={0} />
      );

      act(() => {
        rerender(<TerminalStep command="ls" stepId="t-1" onStepComplete={jest.fn()} resetTrigger={1} />);
      });

      expect(mockResetStep).not.toHaveBeenCalled();
      expect(mockCheckerResetStep).toHaveBeenCalledWith({ skipStoreWrite: true });
    });

    it('writes the store itself when there is no section to own it', () => {
      const { rerender } = render(<TerminalStep command="ls" stepId="t-2" resetTrigger={0} />);

      act(() => {
        rerender(<TerminalStep command="ls" stepId="t-2" resetTrigger={1} />);
      });

      expect(mockResetStep).toHaveBeenCalledWith('t-2', undefined);
    });
  });
});
