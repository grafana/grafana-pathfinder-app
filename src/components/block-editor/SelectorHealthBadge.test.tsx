import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { SelectorHealthBadge } from './SelectorHealthBadge';

jest.mock('@grafana/ui', () => ({
  ...jest.requireActual('@grafana/ui'),
  Tooltip: ({ content, children }: { content: string; children: React.ReactNode }) => (
    <span data-testid="selector-warnings" title={content}>
      {children}
    </span>
  ),
}));

describe('SelectorHealthBadge', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the generator-derived method and stability score for a data-testid selector', async () => {
    document.body.innerHTML = '<button data-testid="save">Save</button>';

    render(<SelectorHealthBadge reftarget="button[data-testid='save']" />);

    await waitFor(() => expect(screen.getByText('data-testid')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('1 match')).toBeInTheDocument();
  });

  it('rates a bare positional selector with a low stability score', async () => {
    document.body.innerHTML = '<button>A</button><button id="second">B</button>';

    render(<SelectorHealthBadge reftarget="button:nth-of-type(2)" />);

    await waitFor(() => expect(screen.getByText('nth-of-type')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it.each([
    ['without a target state', '', true],
    ['with a target state', 'aria-expanded:true', false],
  ])('flags a toggle-shaped selector that does not match on this page %s', async (_label, targetstate, flagged) => {
    render(
      <SelectorHealthBadge reftarget='button[aria-label="Expand row"]' checkTargetState targetstate={targetstate} />
    );

    await waitFor(() => expect(screen.getByText('0 matches')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByTestId('selector-warnings').title.includes('section recovery can reopen it')).toBe(flagged);
  });
});
