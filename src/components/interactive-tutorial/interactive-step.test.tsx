import React from 'react';
import { render, screen } from '@testing-library/react';
import { InteractiveStep } from './interactive-step';

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
