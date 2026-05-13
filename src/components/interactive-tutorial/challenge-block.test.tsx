import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { from } from 'rxjs';

import { ChallengeBlock, resetChallengeCounter } from './challenge-block';
import { useTerminalContext } from '../../integrations/coda/TerminalContext';
import { checkPostconditions } from '../../requirements-manager';
import { getBackendSrv } from '@grafana/runtime';

jest.mock('../../integrations/coda/TerminalContext', () => ({
  useTerminalContext: jest.fn(),
}));

jest.mock('../../requirements-manager', () => ({
  checkPostconditions: jest.fn(),
}));

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

jest.mock('./use-standalone-persistence', () => ({
  useStandalonePersistence: jest.fn(),
}));

const mockedUseTerminalContext = useTerminalContext as jest.MockedFunction<typeof useTerminalContext>;
const mockedCheckPostconditions = checkPostconditions as jest.MockedFunction<typeof checkPostconditions>;
const mockedGetBackendSrv = getBackendSrv as jest.MockedFunction<typeof getBackendSrv>;

/**
 * The challenge block calls getBackendSrv().fetch(...) which returns an
 * Observable. The test mock translates a plain "post-like" mock function
 * (taking url, body → resolved response) into the Observable shape so that
 * existing .mockResolvedValue / .mockResolvedValueOnce calls keep working.
 */
function setBackend(post: jest.Mock): void {
  const fetch = jest.fn((opts: { url: string; data?: unknown }) => {
    return from(Promise.resolve(post(opts.url, opts.data)).then((result) => ({ data: result })));
  });
  mockedGetBackendSrv.mockReturnValue({ fetch } as unknown as ReturnType<typeof getBackendSrv>);
}

interface MockCtxOverrides {
  status?: 'disconnected' | 'connecting' | 'connected' | 'error';
  openTerminal?: jest.Mock;
}

function mockTerminalCtx(overrides: MockCtxOverrides = {}): { openTerminal: jest.Mock } {
  const openTerminal = overrides.openTerminal ?? jest.fn();
  mockedUseTerminalContext.mockReturnValue({
    status: overrides.status ?? 'disconnected',
    connect: jest.fn(),
    disconnect: jest.fn(),
    sendCommand: jest.fn(),
    openTerminal,
    isExpanded: false,
    setIsExpanded: jest.fn(),
    _register: jest.fn(),
  });
  return { openTerminal };
}

const baseProps = {
  title: 'Fix the broken scrape',
  brief: 'Alloy is misconfigured. Restore metric collection.',
  vmTemplate: 'vm-aws-alloy-scenario',
  successCriteria: 'coda-exit-zero:curl -sf localhost:9090/-/healthy',
};

beforeEach(() => {
  jest.clearAllMocks();
  resetChallengeCounter();
});

describe('ChallengeBlock', () => {
  it('renders idle state with Start challenge button', () => {
    mockTerminalCtx();
    render(<ChallengeBlock {...baseProps} />);
    expect(screen.getByRole('heading', { name: /fix the broken scrape/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start challenge/i })).toBeInTheDocument();
  });

  it('calls openTerminal with vm options on Start', async () => {
    const { openTerminal } = mockTerminalCtx();
    render(<ChallengeBlock {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    expect(openTerminal).toHaveBeenCalledWith({
      template: 'vm-aws-alloy-scenario',
      app: undefined,
      scenario: undefined,
    });
  });

  it('runs setup commands sequentially after terminal connects and surfaces Check my work', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);

    const { rerender } = render(<ChallengeBlock {...baseProps} setupCommands={['echo one', 'echo two']} />);

    // First mount with disconnected status, user clicks Start.
    mockTerminalCtx({ status: 'disconnected' });
    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    // Simulate the terminal connecting by re-rendering with the connected status.
    mockTerminalCtx({ status: 'connected' });
    rerender(<ChallengeBlock {...baseProps} setupCommands={['echo one', 'echo two']} />);

    // The two setup commands + the sentinel write should all run.
    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(3);
    });
    expect(post.mock.calls[0]![1]).toMatchObject({ command: 'echo one', mode: 'raw' });
    expect(post.mock.calls[1]![1]).toMatchObject({ command: 'echo two', mode: 'raw' });
    expect(post.mock.calls[2]![1]).toMatchObject({
      command: expect.stringContaining('/tmp/pathfinder-ready'),
      mode: 'raw',
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });
  });

  it('recovers when Try again is clicked after a VM-provisioning failure', async () => {
    // First mount with status='error' simulates the situation immediately
    // after a credentials failure: the terminalCtx already reports 'error'.
    // Without the stale-status guard, the effect would observe this stale
    // 'error' on the next Try-again click and immediately fall back to
    // setup-failed before the new connection attempt could complete.
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);
    mockTerminalCtx({ status: 'error' });

    const { rerender } = render(<ChallengeBlock {...baseProps} setupCommands={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    // Status hasn't changed yet — effect should NOT transition to setup-failed.
    expect(screen.queryByText(/could not start the challenge/i)).not.toBeInTheDocument();

    // The terminal eventually connects after openTerminal.
    mockTerminalCtx({ status: 'connected' });
    rerender(<ChallengeBlock {...baseProps} setupCommands={[]} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });
  });

  it('transitions to setup-failed when a setup command exits non-zero', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ stdout: '', stderr: 'permission denied\n', exitCode: 1, durationMs: 5 });
    setBackend(post);
    mockTerminalCtx({ status: 'connected' });

    render(<ChallengeBlock {...baseProps} setupCommands={['rm /etc/secrets']} />);
    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not start the challenge/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('marks complete and dispatches interactive-action-completed when the success criterion passes', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);
    mockedCheckPostconditions.mockResolvedValue({
      requirements: baseProps.successCriteria,
      pass: true,
      error: [],
    });
    mockTerminalCtx({ status: 'connected' });

    const eventSpy = jest.fn();
    window.addEventListener('interactive-action-completed', eventSpy);
    render(<ChallengeBlock {...baseProps} setupCommands={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /check my work/i }));

    await waitFor(() => {
      expect(screen.getByText(/challenge solved/i)).toBeInTheDocument();
    });
    expect(eventSpy).toHaveBeenCalled();
    const dispatched = eventSpy.mock.calls[0]![0] as CustomEvent;
    expect(dispatched.detail).toMatchObject({ blockType: 'challenge', state: 'completed' });

    window.removeEventListener('interactive-action-completed', eventSpy);
  });

  it('returns to failed-check state when verification fails and exposes Check again', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);
    mockedCheckPostconditions.mockResolvedValue({
      requirements: baseProps.successCriteria,
      pass: false,
      error: [{ requirement: baseProps.successCriteria, pass: false, error: 'Check command exited with code 1' }],
    });
    mockTerminalCtx({ status: 'connected' });

    render(<ChallengeBlock {...baseProps} setupCommands={[]} failureMessage="Try harder." />);

    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /check my work/i }));

    await waitFor(() => {
      expect(screen.getByText(/not solved yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument();
  });

  it('cancel button returns the block to idle without finishing setup', async () => {
    // Setup never resolves so we can observe the Cancel button rendered
    // during 'preparing' and verify the state machine returns to idle.
    let resolveFirst: (value: unknown) => void = () => {};
    const post = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    setBackend(post);
    mockTerminalCtx({ status: 'connected' });

    render(<ChallengeBlock {...baseProps} setupCommands={['sleep 30']} />);
    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    // Wait for setup to start (preparing banner appears with the spinner).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Resolve the in-flight post so the loop continues and sees the cancel flag.
    resolveFirst({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start challenge/i })).toBeInTheDocument();
    });
  });

  it('reveals hints one at a time when the user clicks', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);
    mockTerminalCtx({ status: 'connected' });

    render(
      <ChallengeBlock
        {...baseProps}
        setupCommands={[]}
        hintLevels={[{ text: 'Check Alloy logs' }, { text: 'Look at the scrape target port' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });

    expect(screen.queryByText(/check alloy logs/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show a hint/i }));
    expect(screen.getByText(/check alloy logs/i)).toBeInTheDocument();
    expect(screen.queryByText(/scrape target port/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show next hint/i }));
    expect(screen.getByText(/scrape target port/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show.*hint/i })).not.toBeInTheDocument();
  });
});
