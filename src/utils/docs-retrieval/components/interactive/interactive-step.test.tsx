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
