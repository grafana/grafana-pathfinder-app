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
    container: '',
    completed: '',
    disabled: '',
    content: '',
    commandBlock: '',
    actions: '',
    completedBadge: '',
    stepHeader: '',
    stepLabel: '',
    requirementMessage: '',
    copyFeedback: '',
  }),
}));

// Mock useStepChecker
jest.mock('../../../requirements-manager', () => ({
  useStepChecker: () => ({
    isEnabled: true,
    isChecking: false,
    explanation: null,
  }),
  validateInteractiveRequirements: jest.fn(),
}));

// Mock useStandalonePersistence
jest.mock('./use-standalone-persistence', () => ({
  useStandalonePersistence: jest.fn(),
}));

// Mock TerminalContext
const mockSendCommand = jest.fn().mockResolvedValue(undefined);
const mockOpenTerminal = jest.fn();
let mockTerminalStatus = 'connected';

jest.mock('../../../integrations/coda/TerminalContext', () => ({
  useTerminalContext: () => ({
    status: mockTerminalStatus,
    sendCommand: mockSendCommand,
    openTerminal: mockOpenTerminal,
    vmId: 'test-vm',
  }),
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

  it('displays step position when stepIndex and totalSteps are provided', () => {
    render(<TerminalStep command="ls" stepIndex={0} totalSteps={3} />);

    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });
});
