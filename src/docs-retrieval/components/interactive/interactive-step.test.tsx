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
