/**
 * Tests for the TerminalStep component.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TerminalStep } from './terminal-step';

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

// Mock useStepChecker
jest.mock('../../requirements-manager', () => ({
  useStepChecker: () => ({
    isEnabled: true,
    isChecking: false,
    explanation: null,
  }),
  validateInteractiveRequirements: jest.fn(),
}));

// Mock the completion store (unit tests don't drive persistence here)
jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: jest.fn(() => ({ completed: false, reason: null })),
  markStepCompleted: jest.fn(),
  resetStep: jest.fn(),
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
  });

  it('sends command to terminal when Exec is clicked', async () => {
    render(<TerminalStep command="echo hello" />);

    fireEvent.click(screen.getByText('Exec'));

    await waitFor(() => {
      expect(mockSendCommand).toHaveBeenCalledWith('echo hello');
    });
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
});
