import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { ChallengeBlock, resetChallengeCounter } from './challenge-block';
import { resetInteractiveCounters } from './interactive-section';
import { useTerminalContext } from '../../integrations/coda/TerminalContext';
import { useCodaSessionEligibility, useCodaTerminalGate } from '../../integrations/coda/useCodaAvailability.hook';
import { execInSession } from '../../integrations/coda/coda-api';
import { checkPostconditions, checkRequirements } from '../../requirements-manager';
import { useStepCompletion } from '../../global-state/completion-store';

jest.mock('../../integrations/coda/TerminalContext', () => ({
  useTerminalContext: jest.fn(),
}));

// Only the two hooks are mocked. The message builders stay real, so every
// refusal sentence asserted below is the one a learner would read.
jest.mock('../../integrations/coda/useCodaAvailability.hook', () => ({
  ...jest.requireActual('../../integrations/coda/useCodaAvailability.hook'),
  useCodaTerminalGate: jest.fn(),
  useCodaSessionEligibility: jest.fn(),
}));

const mockMarkSkipped = jest.fn();
const mockUseStepChecker = jest.fn((props: { requirements?: string; objectives?: string; skippable?: boolean }) => ({
  isEnabled: true,
  isSequentialBlock: false,
  isCompleted: false,
  isChecking: false,
  explanation: null as string | null | undefined,
  canSkip: Boolean(props.skippable),
  markSkipped: mockMarkSkipped,
  resetStep: jest.fn(),
}));

jest.mock('../../requirements-manager', () => {
  const checkPostconditions = jest.fn();
  const checkRequirements = jest.fn();
  return {
    checkRequirements,
    checkPostconditions,
    validateInteractiveRequirements: jest.fn(),
    useGuideRequirements: () => ({ checkPostconditions, checkRequirements }),
    useStepChecker: (props: Parameters<typeof mockUseStepChecker>[0]) => mockUseStepChecker(props),
  };
});

// Only the request is mocked; toCodaError and the error classification are
// real, so the messages asserted below are the ones a learner would see.
jest.mock('../../integrations/coda/coda-api', () => ({
  ...jest.requireActual('../../integrations/coda/coda-api'),
  execInSession: jest.fn(),
}));

jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: jest.fn(() => ({ completed: false, reason: null })),
  markStepCompleted: jest.fn(),
  resetStep: jest.fn(),
  STANDALONE_SECTION_ID: '__standalone__',
}));

const mockedUseTerminalContext = useTerminalContext as jest.MockedFunction<typeof useTerminalContext>;
const mockedUseStepCompletion = useStepCompletion as jest.MockedFunction<typeof useStepCompletion>;
const mockedUseCodaTerminalGate = useCodaTerminalGate as jest.MockedFunction<typeof useCodaTerminalGate>;
const mockedUseCodaSessionEligibility = useCodaSessionEligibility as jest.MockedFunction<
  typeof useCodaSessionEligibility
>;
const mockedExecInSession = execInSession as jest.MockedFunction<typeof execInSession>;
const mockedCheckPostconditions = checkPostconditions as jest.MockedFunction<typeof checkPostconditions>;
const mockedCheckRequirements = checkRequirements as jest.MockedFunction<typeof checkRequirements>;

const SESSION_ID = 's_0123456789abcdef0123456789abcdef';

/**
 * Routes execInSession through a plain "post-like" mock taking
 * (sessionId, request) so assertions on the request body stay at arg index 1.
 */
function setBackend(post: jest.Mock): void {
  mockedExecInSession.mockImplementation((sessionId, req) => Promise.resolve(post(sessionId, req)));
}

interface MockCtxOverrides {
  status?: 'disconnected' | 'connecting' | 'connected' | 'error';
  openTerminal?: jest.Mock;
  sessionId?: string | null;
  error?: string | null;
  isTerminalRegistered?: boolean;
}

function mockTerminalCtx(overrides: MockCtxOverrides = {}): { openTerminal: jest.Mock; disconnect: jest.Mock } {
  // openTerminal resolves with the session the caller may use — the contract
  // that keeps setup off a session being torn down.
  const openTerminal =
    overrides.openTerminal ??
    jest.fn().mockResolvedValue(overrides.sessionId === undefined ? SESSION_ID : overrides.sessionId);
  const disconnect = jest.fn();
  mockedUseTerminalContext.mockReturnValue({
    status: overrides.status ?? 'disconnected',
    sessionId: overrides.sessionId === undefined ? SESSION_ID : overrides.sessionId,
    error: overrides.error ?? null,
    isTerminalRegistered: overrides.isTerminalRegistered ?? true,
    connect: jest.fn(),
    disconnect,
    sendCommand: jest.fn(),
    openTerminal,
    isExpanded: false,
    setIsExpanded: jest.fn(),
    _register: jest.fn(),
  });
  return { openTerminal, disconnect };
}

const baseProps = {
  title: 'Fix the broken scrape',
  brief: 'Alloy is misconfigured. Restore metric collection.',
  vmTemplate: 'vm-aws-alloy-scenario',
  successCriteria: 'coda-exit-zero:curl -sf localhost:9090/-/healthy',
};

interface MockCheckerOverrides {
  isEnabled?: boolean;
  isSequentialBlock?: boolean;
  isCompleted?: boolean;
  isChecking?: boolean;
  explanation?: string | null | undefined;
  canSkip?: boolean;
}

function mockCheckerState(overrides: MockCheckerOverrides = {}) {
  return {
    isEnabled: true,
    isSequentialBlock: false,
    isCompleted: false,
    isChecking: false,
    explanation: null as string | null | undefined,
    canSkip: true,
    markSkipped: mockMarkSkipped,
    resetStep: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetChallengeCounter();
  mockedUseCodaTerminalGate.mockReturnValue('configured');
  mockedUseCodaSessionEligibility.mockReturnValue({ state: 'eligible' });
  mockedUseStepCompletion.mockReturnValue({ completed: false, reason: null });
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
    expect(post.mock.calls[0]![1]).toMatchObject({ command: 'echo one' });
    expect(post.mock.calls[1]![1]).toMatchObject({ command: 'echo two' });
    expect(post.mock.calls[2]![1]).toMatchObject({
      command: expect.stringContaining('/tmp/pathfinder-ready'),
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });
  });

  it('runs setupScript as a single exec call when provided', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);
    mockTerminalCtx({ status: 'connected' });

    const script = "echo one\necho two\ncat <<'EOF' > /tmp/x\nhello\nEOF";
    render(<ChallengeBlock {...baseProps} setupScript={script} setupCommands={undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    // Exactly two calls: the script itself, then the sentinel write.
    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(2);
    });
    expect(post.mock.calls[0]![1]).toMatchObject({ command: script, timeoutMs: 120_000 });
    expect(post.mock.calls[1]![1]).toMatchObject({
      command: expect.stringContaining('/tmp/pathfinder-ready'),
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });
  });

  it('prefers setupScript over setupCommands when both are present', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);
    mockTerminalCtx({ status: 'connected' });

    render(
      <ChallengeBlock
        {...baseProps}
        setupScript="echo from-script"
        setupCommands={['echo from-array-1', 'echo from-array-2']}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(2);
    });
    // The first call is the script — the array path is fully skipped.
    expect(post.mock.calls[0]![1]).toMatchObject({ command: 'echo from-script' });
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

  // The terminal can report "connected" a beat before the session id lands. Setup
  // must fail loudly rather than exec against a missing session.
  it('runs setup against the session openTerminal resolved, not the one that was live at click time', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);

    // Challenge A is connected on a different VM. Starting this one replaces
    // that session, and the SDK deletes the session it replaces — so every exec
    // has to go to the id openTerminal hands back, never to OLD_SESSION.
    const OLD_SESSION = 's_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const NEW_SESSION = 's_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const openTerminal = jest.fn().mockResolvedValue(NEW_SESSION);
    mockTerminalCtx({ status: 'connected', sessionId: OLD_SESSION, openTerminal });

    render(<ChallengeBlock {...baseProps} setupCommands={['echo one']} />);
    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(2);
    });
    const sessionsUsed = post.mock.calls.map((call) => call[0]);
    expect(sessionsUsed).toEqual([NEW_SESSION, NEW_SESSION]);
    expect(sessionsUsed).not.toContain(OLD_SESSION);
  });

  it('does not start setup when the requested session never arrives', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);

    // Cancelled, or a connect that failed: openTerminal resolves with no
    // session. Running setup anyway is what would hit a deleted VM.
    const openTerminal = jest.fn().mockResolvedValue(null);
    mockTerminalCtx({ status: 'disconnected', sessionId: null, openTerminal });

    render(<ChallengeBlock {...baseProps} setupCommands={['echo one']} />);
    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    await waitFor(() => {
      expect(openTerminal).toHaveBeenCalled();
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('fails setup when the terminal is connected but there is no session id', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);
    mockTerminalCtx({ status: 'connected', sessionId: null });

    render(<ChallengeBlock {...baseProps} setupCommands={['echo one']} />);
    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not start the challenge/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/no active sandbox session/i)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
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
      // The author's failureMessage now renders as the primary content of
      // the failed-check banner, without a "Not solved yet" preamble that
      // didn't add information.
      expect(screen.getByText(/try harder\./i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument();
  });

  it('recovers from a checkPostconditions rejection into failed-check with a retry button', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);
    // Simulate an unexpected pipeline failure (network blip, requirements bug).
    // The block must not stay stuck on the 'checking' spinner — it should
    // surface the error and expose a way to retry.
    mockedCheckPostconditions.mockRejectedValue(new Error('pipeline exploded'));
    mockTerminalCtx({ status: 'connected' });

    render(<ChallengeBlock {...baseProps} setupCommands={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /check my work/i }));

    await waitFor(() => {
      expect(screen.getByText(/pipeline exploded/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument();
  });

  it('ignores a late-resolving check after Cancel resets the block to idle', async () => {
    const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
    setBackend(post);
    mockTerminalCtx({ status: 'connected' });

    let resolveCheck: (value: Awaited<ReturnType<typeof checkPostconditions>>) => void = () => undefined;
    mockedCheckPostconditions.mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof checkPostconditions>>>((resolve) => {
          resolveCheck = resolve;
        })
    );

    render(<ChallengeBlock {...baseProps} setupCommands={[]} stepId="ch-cancel-check" />);

    fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /check my work/i }));

    await waitFor(() => {
      expect(screen.getByText(/checking your work/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start challenge/i })).toBeInTheDocument();
    });

    resolveCheck({ requirements: baseProps.successCriteria, pass: true, error: [] });

    await waitFor(() => {
      expect(mockedCheckPostconditions).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByText(/challenge solved/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start challenge/i })).toBeInTheDocument();
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

  describe('standard (non-Coda) mode', () => {
    it('renders Check my work immediately without a Start button', () => {
      mockTerminalCtx({ status: 'disconnected' });
      render(<ChallengeBlock {...baseProps} mode="standard" successCriteria="has-dashboard-named:My Dashboard" />);

      expect(screen.queryByRole('button', { name: /start challenge/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });

    it('does NOT call openTerminal on mount or interaction', async () => {
      const { openTerminal } = mockTerminalCtx({ status: 'disconnected' });
      mockedCheckPostconditions.mockResolvedValue({
        requirements: 'has-dashboard-named:My Dashboard',
        pass: false,
        error: [{ requirement: 'has-dashboard-named:My Dashboard', pass: false, error: 'not found' }],
      });

      render(<ChallengeBlock {...baseProps} mode="standard" successCriteria="has-dashboard-named:My Dashboard" />);
      fireEvent.click(screen.getByRole('button', { name: /check my work/i }));

      await waitFor(() => {
        expect(mockedCheckPostconditions).toHaveBeenCalled();
      });
      expect(openTerminal).not.toHaveBeenCalled();
    });

    it('passes the success criterion verbatim to checkPostconditions (no coda-exit-zero wrapping)', async () => {
      mockTerminalCtx({ status: 'disconnected' });
      mockedCheckPostconditions.mockResolvedValue({
        requirements: 'has-dashboard-named:My Dashboard',
        pass: true,
        error: [],
      });

      render(<ChallengeBlock {...baseProps} mode="standard" successCriteria="has-dashboard-named:My Dashboard" />);
      fireEvent.click(screen.getByRole('button', { name: /check my work/i }));

      await waitFor(() => {
        expect(mockedCheckPostconditions).toHaveBeenCalledWith(
          expect.objectContaining({ requirements: 'has-dashboard-named:My Dashboard' })
        );
      });
    });

    it('reaches solved state via the standard-mode check path', async () => {
      mockTerminalCtx({ status: 'disconnected' });
      mockedCheckPostconditions.mockResolvedValue({
        requirements: 'has-dashboard-named:My Dashboard',
        pass: true,
        error: [],
      });

      render(<ChallengeBlock {...baseProps} mode="standard" successCriteria="has-dashboard-named:My Dashboard" />);
      fireEvent.click(screen.getByRole('button', { name: /check my work/i }));

      await waitFor(() => {
        expect(screen.getByText(/challenge solved/i)).toBeInTheDocument();
      });
    });

    it('skip in standard mode never disconnects the shared terminal session', () => {
      const { disconnect } = mockTerminalCtx({ status: 'disconnected' });

      // Drive the checker through one check cycle so Skip is legitimately shown.
      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: true }));
      const skipProps = {
        ...baseProps,
        mode: 'standard' as const,
        skippable: true,
        stepId: 'ch-std-skip',
        successCriteria: 'has-dashboard-named:My Dashboard',
      };
      const { rerender } = render(<ChallengeBlock {...skipProps} />);
      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: false }));
      rerender(<ChallengeBlock {...skipProps} />);
      fireEvent.click(screen.getByRole('button', { name: /skip/i }));

      expect(mockMarkSkipped).toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();
    });
  });

  // Issue #1541: TerminalProvider mounts unconditionally while TerminalPanel —
  // which registers the real connect — is gated, so a coda-mode challenge used
  // to sit on "Provisioning challenge VM…" forever with only a Cancel button.
  describe('Coda availability gating', () => {
    it('says why instead of offering Start when the sandbox terminal is turned off', () => {
      mockedUseCodaTerminalGate.mockReturnValue('disabled');
      mockTerminalCtx();

      render(<ChallengeBlock {...baseProps} />);

      expect(screen.getByText(/sandbox terminal is turned off/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /start challenge/i })).not.toBeInTheDocument();
    });

    it('says why instead of offering Start when the Coda app plugin is absent', () => {
      mockedUseCodaTerminalGate.mockReturnValue('plugin-missing');
      mockTerminalCtx();

      render(<ChallengeBlock {...baseProps} />);

      expect(screen.getByText(/coda app plugin is not installed/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /start challenge/i })).not.toBeInTheDocument();
    });

    // Before `caller.canCreateSessions`, the only way to learn the role floor
    // was a reactive 403 after a Start click had already spent a session
    // request and a VM connect attempt.
    it('says why instead of offering Start when the backend says the role is too low', () => {
      mockedUseCodaSessionEligibility.mockReturnValue({ state: 'role_forbidden', minimumSessionRole: 'Editor' });
      mockTerminalCtx();

      render(<ChallengeBlock {...baseProps} />);

      expect(screen.getByText(/needs Editor or above/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /start challenge/i })).not.toBeInTheDocument();
    });

    it('names the floor the backend reported rather than assuming Editor', () => {
      mockedUseCodaSessionEligibility.mockReturnValue({ state: 'role_forbidden', minimumSessionRole: 'Admin' });
      mockTerminalCtx();

      render(<ChallengeBlock {...baseProps} />);

      expect(screen.getByText(/needs Admin or above/i)).toBeInTheDocument();
    });

    // A Coda plugin older than the field cannot answer, and the probe is async.
    // Neither may hide the sandbox from a learner who is entitled to it — the
    // reactive 403 path still covers being wrong.
    it.each([
      ['the backend cannot answer', { state: 'unknown' } as const],
      ['the probe has not resolved', { state: 'checking' } as const],
      ['the caller is eligible', { state: 'eligible' } as const],
    ])('still offers Start when %s', (_name, eligibility) => {
      mockedUseCodaSessionEligibility.mockReturnValue(eligibility);
      mockTerminalCtx();

      render(<ChallengeBlock {...baseProps} />);

      expect(screen.getByRole('button', { name: /start challenge/i })).toBeInTheDocument();
    });

    it('leaves standard mode alone when Coda is unavailable', () => {
      mockedUseCodaTerminalGate.mockReturnValue('plugin-missing');
      mockTerminalCtx();

      render(<ChallengeBlock {...baseProps} mode="standard" successCriteria="has-dashboard-named:X" />);

      expect(screen.queryByText(/sandbox not available/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });

    it('fails fast rather than hanging when the context is present but no panel registered', async () => {
      const { openTerminal } = mockTerminalCtx({ isTerminalRegistered: false });

      render(<ChallengeBlock {...baseProps} />);
      fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

      await waitFor(() => {
        expect(screen.getByText(/sandbox terminal is not available here/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/provisioning challenge vm/i)).not.toBeInTheDocument();
      expect(openTerminal).not.toHaveBeenCalled();
    });

    it('fails once an in-flight availability probe resolves to unavailable', async () => {
      mockedUseCodaTerminalGate.mockReturnValue('checking');
      mockTerminalCtx({ isTerminalRegistered: false });

      const { rerender } = render(<ChallengeBlock {...baseProps} />);
      fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

      // Still probing: the block waits rather than guessing.
      expect(screen.getByText(/provisioning challenge vm/i)).toBeInTheDocument();

      mockedUseCodaTerminalGate.mockReturnValue('plugin-missing');
      mockTerminalCtx({ isTerminalRegistered: false });
      rerender(<ChallengeBlock {...baseProps} />);

      await waitFor(() => {
        expect(screen.getByText(/coda app plugin is not installed/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/provisioning challenge vm/i)).not.toBeInTheDocument();
    });

    it('surfaces the terminal’s own error instead of a generic retry hint', async () => {
      mockTerminalCtx({ status: 'disconnected' });

      const { rerender } = render(<ChallengeBlock {...baseProps} />);
      fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

      mockTerminalCtx({
        status: 'error',
        error: 'Coda is not registered. An administrator must complete registration.',
      });
      rerender(<ChallengeBlock {...baseProps} />);

      await waitFor(() => {
        expect(screen.getByText(/coda is not registered/i)).toBeInTheDocument();
      });
    });
  });

  describe('counter integration with resetInteractiveCounters', () => {
    // Regression: the challenge counter must be reset alongside the other
    // block-type counters so reset-guide + content-reload doesn't keep
    // accumulating challenge-N IDs across loads.
    it('is reset by resetInteractiveCounters so step IDs stay deterministic', () => {
      mockTerminalCtx();

      const first = render(<ChallengeBlock {...baseProps} />);
      expect(first.getByTestId('challenge-block-challenge-1')).toBeInTheDocument();
      first.unmount();

      const second = render(<ChallengeBlock {...baseProps} />);
      expect(second.getByTestId('challenge-block-challenge-2')).toBeInTheDocument();
      second.unmount();

      resetInteractiveCounters();

      const third = render(<ChallengeBlock {...baseProps} />);
      expect(third.getByTestId('challenge-block-challenge-1')).toBeInTheDocument();
    });
  });

  describe('requirements, objectives, and skippable gating', () => {
    beforeEach(() => {
      mockMarkSkipped.mockClear();
      mockUseStepChecker.mockImplementation((props) => ({
        isEnabled: true,
        isSequentialBlock: false,
        isCompleted: false,
        isChecking: false,
        explanation: null,
        canSkip: Boolean(props.skippable),
        markSkipped: mockMarkSkipped,
        resetStep: jest.fn(),
      }));
    });

    it('renders requirement warning banner and hides Start button when disabled by requirements', () => {
      mockTerminalCtx();
      mockUseStepChecker.mockReturnValue({
        isEnabled: false,
        isSequentialBlock: false,
        isCompleted: false,
        isChecking: false,
        explanation: 'Complete previous step first',
        canSkip: false,
        markSkipped: mockMarkSkipped,
        resetStep: jest.fn(),
      });

      render(<ChallengeBlock {...baseProps} requirements="req-1" stepId="ch-1" />);

      expect(screen.getByTestId('challenge-requirement-warning-ch-1')).toHaveTextContent(
        'Complete previous step first'
      );
      expect(screen.queryByRole('button', { name: /start challenge/i })).not.toBeInTheDocument();
    });

    it('passes objectives: "" to useStepChecker to prevent Phase 1 auto-completion and does not show solved UI', () => {
      mockTerminalCtx();
      render(<ChallengeBlock {...baseProps} objectives="obj-1" stepId="ch-2" />);

      expect(mockUseStepChecker).toHaveBeenCalledWith(
        expect.objectContaining({
          objectives: '',
          stepId: 'ch-2',
        })
      );
      // Ensure challenge block is not solved until check passes
      expect(screen.queryByText(/challenge solved/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /start challenge/i })).toBeInTheDocument();
    });

    it('renders Skip button when skippable is true and calls markSkipped and onStepComplete(id) on click', () => {
      mockTerminalCtx();
      const onStepComplete = jest.fn();

      // Drive the checker through one check cycle so Skip is legitimately shown.
      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: true }));
      const skipProps = { ...baseProps, skippable: true, stepId: 'ch-3', onStepComplete };
      const { rerender } = render(<ChallengeBlock {...skipProps} />);
      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: false }));
      rerender(<ChallengeBlock {...skipProps} />);

      const skipButton = screen.getByRole('button', { name: /skip/i });
      expect(skipButton).toBeInTheDocument();

      fireEvent.click(skipButton);

      expect(mockMarkSkipped).toHaveBeenCalled();
      expect(onStepComplete).toHaveBeenCalledWith('ch-3');
    });

    it('hides Skip while sequentially blocked even when skippable', () => {
      mockTerminalCtx();
      // canSkip echoes the skippable prop through SET_BLOCKED, so the gate is isSequentialBlock.
      mockUseStepChecker.mockReturnValue({
        isEnabled: false,
        isSequentialBlock: true,
        isCompleted: false,
        isChecking: false,
        explanation: 'Complete previous step first',
        canSkip: true,
        markSkipped: mockMarkSkipped,
        resetStep: jest.fn(),
      });

      render(<ChallengeBlock {...baseProps} skippable={true} stepId="ch-blocked-skip" />);

      expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
    });

    it('still offers Skip when this step’s own requirements fail (not a sequential block)', () => {
      mockTerminalCtx();
      // Resolve as requirement-failed rather than sequentially blocked.
      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: true }));
      const ownReqsProps = { ...baseProps, skippable: true, stepId: 'ch-own-reqs' };
      const { rerender } = render(<ChallengeBlock {...ownReqsProps} />);
      mockUseStepChecker.mockReturnValue(
        mockCheckerState({
          isEnabled: false,
          isSequentialBlock: false,
          isCompleted: false,
          isChecking: false,
          explanation: 'Dashboard not found yet',
          canSkip: true,
        })
      );
      rerender(<ChallengeBlock {...ownReqsProps} />);

      expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
    });

    it('hides Skip while the checker is still mid-check, even when not sequentially blocked', () => {
      mockTerminalCtx();
      mockUseStepChecker.mockReturnValue(
        mockCheckerState({
          isEnabled: false,
          isSequentialBlock: false,
          isCompleted: false,
          isChecking: true,
          explanation: undefined,
          canSkip: true,
        })
      );

      render(<ChallengeBlock {...baseProps} skippable={true} stepId="ch-unresolved-skip" />);

      expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
    });

    it('shows Skip once an in-flight check resolves as not blocked', () => {
      mockTerminalCtx();
      mockUseStepChecker.mockReturnValue(
        mockCheckerState({
          isEnabled: false,
          isSequentialBlock: false,
          isCompleted: false,
          isChecking: true,
          explanation: undefined,
          canSkip: true,
        })
      );
      const resolvingProps = { ...baseProps, skippable: true, stepId: 'ch-resolve-skip' };
      const { rerender } = render(<ChallengeBlock {...resolvingProps} />);

      expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();

      mockUseStepChecker.mockReturnValue(
        mockCheckerState({
          isEnabled: true,
          isSequentialBlock: false,
          isCompleted: false,
          isChecking: false,
          explanation: null,
          canSkip: true,
        })
      );
      rerender(<ChallengeBlock {...resolvingProps} />);

      expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
    });

    it('keeps Skip visible during a later heartbeat recheck after resolving once', () => {
      mockTerminalCtx();
      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: true }));
      const recheckProps = { ...baseProps, skippable: true, stepId: 'ch-recheck-skip' };
      const { rerender } = render(<ChallengeBlock {...recheckProps} />);

      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: false }));
      rerender(<ChallengeBlock {...recheckProps} />);
      expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();

      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: true }));
      rerender(<ChallengeBlock {...recheckProps} />);
      expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();

      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: false }));
      rerender(<ChallengeBlock {...recheckProps} />);
      expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
    });

    it('hides Skip while provisioning so Cancel is the only exit', async () => {
      mockedExecInSession.mockImplementation(() => new Promise(() => {}));
      mockTerminalCtx({ status: 'connected' });

      render(<ChallengeBlock {...baseProps} setupCommands={['echo one']} skippable={true} stepId="ch-provision" />);
      fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
    });

    it('renders Challenge skipped when the stored completion reason is skipped', () => {
      mockTerminalCtx();
      mockedUseStepCompletion.mockReturnValue({ completed: true, reason: 'skipped' });

      render(<ChallengeBlock {...baseProps} stepId="ch-skipped" />);

      expect(screen.getByText(/challenge skipped/i)).toBeInTheDocument();
      expect(screen.queryByText(/challenge solved/i)).not.toBeInTheDocument();
    });

    it('does not complete from objectives alone; Check my work is still required', async () => {
      mockTerminalCtx();
      mockedCheckRequirements.mockResolvedValue({
        requirements: 'has-dashboard-named:My Dashboard',
        pass: true,
        error: [],
      });

      render(
        <ChallengeBlock
          {...baseProps}
          mode="standard"
          objectives="has-dashboard-named:My Dashboard"
          stepId="ch-objectives"
        />
      );

      await waitFor(() => {
        expect(mockedCheckRequirements).toHaveBeenCalledWith(
          expect.objectContaining({ requirements: 'has-dashboard-named:My Dashboard' })
        );
      });
      expect(screen.getByText(/objective already met/i)).toBeInTheDocument();
      expect(screen.queryByText(/challenge solved/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
    });

    it('handles Skip correctly in standalone mode without onStepComplete or sectionId', () => {
      mockTerminalCtx();
      // Drive the checker through one check cycle so Skip is legitimately shown.
      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: true }));
      const standaloneProps = {
        ...baseProps,
        skippable: true,
        stepId: 'ch-standalone',
        onStepComplete: undefined,
        sectionId: undefined,
      };
      const { rerender } = render(<ChallengeBlock {...standaloneProps} />);
      mockUseStepChecker.mockReturnValue(mockCheckerState({ isChecking: false }));
      rerender(<ChallengeBlock {...standaloneProps} />);

      const skipButton = screen.getByRole('button', { name: /skip/i });
      fireEvent.click(skipButton);

      expect(mockMarkSkipped).toHaveBeenCalled();
      expect(mockUseStepChecker).toHaveBeenCalledWith(expect.objectContaining({ sectionId: undefined }));
    });

    it('keeps Try again (disabled) and offers Cancel when setup failed but isEnabled is false', async () => {
      mockTerminalCtx({ status: 'connected', sessionId: null });
      mockUseStepChecker.mockImplementation((props) => ({
        isEnabled: true,
        isSequentialBlock: false,
        isCompleted: false,
        isChecking: false,
        explanation: null,
        canSkip: Boolean(props.skippable),
        markSkipped: mockMarkSkipped,
        resetStep: jest.fn(),
      }));

      const { rerender } = render(<ChallengeBlock {...baseProps} setupCommands={['echo one']} />);
      fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
      });

      // Now simulate requirements becoming unsatisfied (isEnabled -> false)
      mockUseStepChecker.mockImplementation((props) => ({
        isEnabled: false,
        isSequentialBlock: false,
        isCompleted: false,
        isChecking: false,
        explanation: 'Prerequisites unmet',
        canSkip: Boolean(props.skippable),
        markSkipped: mockMarkSkipped,
        resetStep: jest.fn(),
      }));

      rerender(<ChallengeBlock {...baseProps} setupCommands={['echo one']} />);

      expect(screen.getByRole('button', { name: /try again/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('keeps Check my work (disabled) and offers Cancel when requirements regress after reaching ready', async () => {
      const post = jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });
      setBackend(post);
      mockTerminalCtx({ status: 'connected' });

      const { rerender } = render(<ChallengeBlock {...baseProps} setupCommands={[]} stepId="ch-regress" />);
      fireEvent.click(screen.getByRole('button', { name: /start challenge/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /check my work/i })).toBeInTheDocument();
      });

      mockUseStepChecker.mockImplementation((props) => ({
        isEnabled: false,
        isSequentialBlock: false,
        isCompleted: false,
        isChecking: false,
        explanation: 'Complete previous step first',
        canSkip: Boolean(props.skippable),
        markSkipped: mockMarkSkipped,
        resetStep: jest.fn(),
      }));

      rerender(<ChallengeBlock {...baseProps} setupCommands={[]} stepId="ch-regress" />);

      expect(screen.getByRole('button', { name: /check my work/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('renders a fallback message while a requirements recheck has no explanation yet', () => {
      mockTerminalCtx();
      mockUseStepChecker.mockReturnValue({
        isEnabled: false,
        isSequentialBlock: false,
        isCompleted: false,
        isChecking: true,
        explanation: undefined,
        canSkip: false,
        markSkipped: mockMarkSkipped,
        resetStep: jest.fn(),
      });

      render(<ChallengeBlock {...baseProps} requirements="req-1" stepId="ch-recheck" />);

      const banner = screen.getByTestId('challenge-requirement-warning-ch-recheck');
      expect(banner.textContent).not.toBe('');
      expect(banner).toHaveTextContent(/checking requirements/i);
    });
  });
});
