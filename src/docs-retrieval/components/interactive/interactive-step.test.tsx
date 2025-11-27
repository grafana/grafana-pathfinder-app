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
