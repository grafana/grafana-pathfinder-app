import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { InteractiveStep } from './interactive-step';
import { InteractiveModeContext } from '../../global-state/interactive-mode-context';
import { ControllerChannelProvider } from '../../global-state/controller-channel';
import { TEST_PAIRING } from '../../test-utils/fake-cross-tab-transport';
import { createPairingAcceptProof } from '../../lib/pairing-manager';

describe('InteractiveStep: showMeText label override', () => {
  it('renders custom Show me label when showMeText is provided', () => {
    render(
      <InteractiveStep
        targetAction="highlight"
        refTarget="a[href='/dashboards']"
        showMe
        doIt={false}
        showMeText="Reveal"
      >
        Example
      </InteractiveStep>
    );

    expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument();
  });
});

describe('InteractiveStep: navigate action type', () => {
  it('renders "Go there" button instead of "Do it" for navigate actions', () => {
    render(
      <InteractiveStep targetAction="navigate" refTarget="/d/qD-rVv6Mz/state-timeline">
        Navigate to the dashboard
      </InteractiveStep>
    );

    expect(screen.getByRole('button', { name: 'Go there' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /do it/i })).not.toBeInTheDocument();
  });

  it('does not render "Show me" button for navigate actions', () => {
    render(
      <InteractiveStep targetAction="navigate" refTarget="/d/qD-rVv6Mz/state-timeline" showMe={true}>
        Navigate to the dashboard
      </InteractiveStep>
    );

    // Even with showMe={true}, navigate actions should not show "Show me" button
    expect(screen.queryByRole('button', { name: /show me/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go there' })).toBeInTheDocument();
  });

  it('renders correct content for navigate action', () => {
    render(
      <InteractiveStep targetAction="navigate" refTarget="/d/qD-rVv6Mz/state-timeline" stepId="section-1-step-1">
        <strong>State Timeline</strong> — Dashboard for tracking service status
      </InteractiveStep>
    );

    expect(screen.getByText(/State Timeline/)).toBeInTheDocument();

    const stepContainer = screen.getByText(/State Timeline/).closest('.interactive-step');
    expect(stepContainer).toBeInTheDocument();
    expect(stepContainer).toHaveAttribute('data-targetaction', 'navigate');
  });
});

describe('InteractiveStep: noop action type', () => {
  it('renders no buttons when both showMe and doIt are false (noop behavior)', () => {
    render(
      <InteractiveStep targetAction="noop" refTarget="" showMe={false} doIt={false}>
        This is an instructional step with no actions
      </InteractiveStep>
    );

    expect(screen.getByText('This is an instructional step with no actions')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /show me/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /do it/i })).not.toBeInTheDocument();
  });

  it('renders content correctly for noop action in a sequence context', () => {
    render(
      <InteractiveStep targetAction="noop" refTarget="" showMe={false} doIt={false} stepId="section-1-step-2">
        <p>Read the documentation before proceeding</p>
      </InteractiveStep>
    );

    expect(screen.getByText('Read the documentation before proceeding')).toBeInTheDocument();

    const stepContainer = screen.getByText('Read the documentation before proceeding').closest('.interactive-step');
    expect(stepContainer).toBeInTheDocument();
    expect(stepContainer).toHaveAttribute('data-targetaction', 'noop');
  });
});

describe('InteractiveStep: popout action type', () => {
  it("renders an 'Undock' button when targetvalue is 'floating'", () => {
    render(
      <InteractiveStep targetAction="popout" refTarget="" targetValue="floating">
        Move me out of the way
      </InteractiveStep>
    );

    expect(screen.getByRole('button', { name: 'Undock' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /do it/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show me/i })).not.toBeInTheDocument();
  });

  it("renders a 'Dock' button when targetvalue is 'sidebar'", () => {
    render(
      <InteractiveStep targetAction="popout" refTarget="" targetValue="sidebar">
        Put me back in the sidebar
      </InteractiveStep>
    );

    expect(screen.getByRole('button', { name: 'Dock' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /do it/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show me/i })).not.toBeInTheDocument();
  });

  it('does not render a "Show me" button even when showMe is true', () => {
    render(
      <InteractiveStep targetAction="popout" refTarget="" targetValue="floating" showMe={true}>
        Pop out
      </InteractiveStep>
    );

    expect(screen.queryByRole('button', { name: /show me/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undock' })).toBeInTheDocument();
  });

  it("dispatches 'pathfinder-request-pop-out' when Undock is clicked", async () => {
    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');
    try {
      render(
        <InteractiveStep targetAction="popout" refTarget="" targetValue="floating" stepId="popout-undock-step">
          Pop out
        </InteractiveStep>
      );

      const button = screen.getByRole('button', { name: 'Undock' });
      button.click();
      // Allow the async pipeline to dispatch
      await new Promise((resolve) => setTimeout(resolve, 0));

      const popOutCall = dispatchSpy.mock.calls.find(
        (call) => (call[0] as Event).type === 'pathfinder-request-pop-out'
      );
      expect(popOutCall).toBeDefined();
    } finally {
      dispatchSpy.mockRestore();
    }
  });

  it("dispatches 'pathfinder-request-dock' when Dock is clicked", async () => {
    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');
    try {
      render(
        <InteractiveStep targetAction="popout" refTarget="" targetValue="sidebar" stepId="popout-dock-step">
          Dock
        </InteractiveStep>
      );

      const button = screen.getByRole('button', { name: 'Dock' });
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const dockCall = dispatchSpy.mock.calls.find((call) => (call[0] as Event).type === 'pathfinder-request-dock');
      expect(dockCall).toBeDefined();
    } finally {
      dispatchSpy.mockRestore();
    }
  });
});

describe('InteractiveStep: controller mode emits over the channel instead of executing', () => {
  function makeTransport() {
    let listener: ((message: any) => void) | null = null;
    return {
      start: jest.fn(),
      stop: jest.fn(),
      post: jest.fn(),
      onMessage: jest.fn((l: (message: any) => void) => {
        listener = l;
        return () => {
          listener = null;
        };
      }),
      emit: (message: any) => listener?.(message),
    };
  }

  function countRequirementChecks(transport: ReturnType<typeof makeTransport>): number {
    return transport.post.mock.calls.map((c) => c[0]).filter((p: any) => p.kind === 'check-requirements').length;
  }

  async function pairWithLive(transport: ReturnType<typeof makeTransport>, liveId = 'live') {
    await waitFor(() =>
      expect(transport.post).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pairing-challenge' }))
    );
    const challenges = transport.post.mock.calls.map((c) => c[0]).filter((p: any) => p.kind === 'pairing-challenge');
    const challenge = challenges[challenges.length - 1];
    const acceptProof = await createPairingAcceptProof(TEST_PAIRING.pairingSecret, {
      pairingId: TEST_PAIRING.pairingId,
      sessionId: challenge.sessionId,
      liveTabId: liveId,
    });
    act(() =>
      transport.emit({
        source: 'pathfinder',
        senderId: liveId,
        timestamp: 0,
        kind: 'pairing-accept',
        sessionId: challenge.sessionId,
        pairingId: TEST_PAIRING.pairingId,
        acceptProof,
      })
    );
    await waitFor(() =>
      expect(transport.post).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sidebar-handoff' }))
    );
  }

  async function renderPairedController(transport: ReturnType<typeof makeTransport>, children: React.ReactNode) {
    const view = render(
      <InteractiveModeContext.Provider value="controller">
        <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
          {null}
        </ControllerChannelProvider>
      </InteractiveModeContext.Provider>
    );
    await pairWithLive(transport);
    view.rerender(
      <InteractiveModeContext.Provider value="controller">
        <ControllerChannelProvider transport={transport} pairing={TEST_PAIRING}>
          {children}
        </ControllerChannelProvider>
      </InteractiveModeContext.Provider>
    );
    return view;
  }

  function replyToRequirementCheck(transport: ReturnType<typeof makeTransport>, pass: boolean, extra = {}) {
    const requests = transport.post.mock.calls.map((c) => c[0]).filter((p: any) => p.kind === 'check-requirements');
    const request = requests[requests.length - 1];
    if (!request) {
      return false;
    }
    transport.emit({
      source: 'pathfinder',
      senderId: 'live',
      timestamp: 0,
      kind: 'requirement-result',
      requestId: request.requestId,
      stepId: request.stepId,
      result: {
        requirements: request.requirements,
        pass,
        error: pass ? [] : [{ requirement: request.requirements, pass: false, ...extra }],
      },
    });
    return true;
  }

  it('emits a "show" step-command when Show me is clicked', async () => {
    const transport = makeTransport();
    await renderPairedController(
      transport,
      <InteractiveStep targetAction="highlight" refTarget="#panel-add" stepId="ctrl-show" showMe doIt={false}>
        Step
      </InteractiveStep>
    );

    const button = await screen.findByRole('button', { name: /show me/i });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    await waitFor(() =>
      expect(transport.post).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'step-command',
          phase: 'show',
          stepId: 'ctrl-show',
          action: expect.objectContaining({ targetAction: 'highlight', refTarget: '#panel-add' }),
        })
      )
    );
  });

  it('emits a "do" step-command when Do it is clicked', async () => {
    const transport = makeTransport();
    await renderPairedController(
      transport,
      <InteractiveStep targetAction="button" refTarget="button[type='submit']" stepId="ctrl-do">
        Step
      </InteractiveStep>
    );

    const button = await screen.findByRole('button', { name: /do it/i });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    await waitFor(() =>
      expect(transport.post).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'step-command', phase: 'do', stepId: 'ctrl-do' })
      )
    );
  });

  it('round-trips tab-local requirements to the live tab instead of stripping them', async () => {
    const transport = makeTransport();
    await renderPairedController(
      transport,
      <InteractiveStep
        targetAction="button"
        refTarget="#not-on-this-tab"
        requirements="exists-reftarget"
        stepId="ctrl-req"
      >
        Step
      </InteractiveStep>
    );

    await waitFor(() =>
      expect(transport.post).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'check-requirements', stepId: 'ctrl-req', requirements: 'exists-reftarget' })
      )
    );
  });

  it('enables a step once the live tab reports its requirements pass', async () => {
    const transport = makeTransport();
    await renderPairedController(
      transport,
      <InteractiveStep targetAction="button" refTarget="#ok" requirements="exists-reftarget" stepId="ctrl-pass">
        Step
      </InteractiveStep>
    );

    await waitFor(() => expect(replyToRequirementCheck(transport, true)).toBe(true));

    const button = await screen.findByRole('button', { name: /do it/i });
    await waitFor(() => expect(button).not.toBeDisabled());

    // Clicking re-verifies against the live tab before acting; answer that
    // second round-trip with a pass so the command is emitted.
    const before = countRequirementChecks(transport);
    fireEvent.click(button);
    await waitFor(() => expect(countRequirementChecks(transport)).toBeGreaterThan(before));
    replyToRequirementCheck(transport, true);

    await waitFor(() =>
      expect(transport.post).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'step-command', phase: 'do', stepId: 'ctrl-pass' })
      )
    );
  });

  it('gates the action when a re-check at click time reports the requirement failed', async () => {
    const transport = makeTransport();
    await renderPairedController(
      transport,
      <InteractiveStep targetAction="button" refTarget="#ok" requirements="navmenu-open" stepId="ctrl-regress">
        Step
      </InteractiveStep>
    );

    // Step starts satisfied, so it enables and Do it is clickable.
    await waitFor(() => expect(replyToRequirementCheck(transport, true)).toBe(true));
    const button = await screen.findByRole('button', { name: /do it/i });
    await waitFor(() => expect(button).not.toBeDisabled());

    // The prerequisite regressed by click time: the re-check fails, so no
    // command is emitted and the fix affordance surfaces instead.
    const before = countRequirementChecks(transport);
    fireEvent.click(button);
    await waitFor(() => expect(countRequirementChecks(transport)).toBeGreaterThan(before));
    replyToRequirementCheck(transport, false, { canFix: true, fixType: 'navigation' });

    expect(await screen.findByRole('button', { name: /fix this/i })).toBeInTheDocument();
    expect(transport.post).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'step-command' }));
  });

  it('surfaces a failing requirement and a fix affordance reported by the live tab', async () => {
    const transport = makeTransport();
    await renderPairedController(
      transport,
      <InteractiveStep targetAction="button" refTarget="#nav" requirements="navmenu-open" stepId="ctrl-fail">
        Step
      </InteractiveStep>
    );

    await waitFor(() =>
      expect(replyToRequirementCheck(transport, false, { canFix: true, fixType: 'navigation' })).toBe(true)
    );

    expect(await screen.findByRole('button', { name: /fix this/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /do it/i })).not.toBeInTheDocument();
  });

  it('fails open to a stripped local check when the live tab never answers (§6.5)', async () => {
    jest.useFakeTimers();
    try {
      const transport = makeTransport();
      await renderPairedController(
        transport,
        <InteractiveStep targetAction="button" refTarget="#ok" requirements="exists-reftarget" stepId="ctrl-timeout">
          Step
        </InteractiveStep>
      );

      // The controller posts the check, but no live tab ever replies. After the
      // round-trip timeout the step must fail OPEN: strip the tab-local
      // `exists-reftarget` token and evaluate the (now empty) remainder locally,
      // which passes — so a disconnected driver stays usable instead of blocked
      // forever on a silent live tab.
      await waitFor(() =>
        expect(transport.post).toHaveBeenCalledWith(expect.objectContaining({ kind: 'check-requirements' }))
      );

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      const button = await screen.findByRole('button', { name: /do it/i });
      await waitFor(() => expect(button).not.toBeDisabled());
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails loud instead of dispatching a controller step with no stepId (F-1063-3)', async () => {
    const transport = makeTransport();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await renderPairedController(
      transport,
      <InteractiveStep targetAction="highlight" refTarget="#panel-add" showMe doIt={false}>
        Step
      </InteractiveStep>
    );

    const button = await screen.findByRole('button', { name: /show me/i });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    await waitFor(() => expect(warn).toHaveBeenCalled());
    // The provider still posts heartbeats; assert no step-command was dispatched.
    expect(transport.post).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'step-command' }));
    warn.mockRestore();
  });
});
