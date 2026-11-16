import React from 'react';
import { render, screen } from '@testing-library/react';
import { HelpFooter } from './HelpFooter';
import { testIds } from '../../constants/testIds';

jest.mock('@grafana/runtime', () => ({
  useHelpNavItem: () => ({
    subTitle: 'Grafana v13.0.0',
    children: [
      { id: 'documentation', text: 'Documentation', icon: 'book', url: 'https://grafana.com/docs/' },
      { id: 'shortcuts', text: 'Keyboard shortcuts', icon: 'keyboard', onClick: jest.fn() },
    ],
  }),
}));

describe('HelpFooter', () => {
  it('renders every help link without icons, and the version', () => {
    render(<HelpFooter />);

    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', 'https://grafana.com/docs/');
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByTestId(testIds.helpFooter.container).querySelectorAll('svg')).toHaveLength(0);
    expect(screen.getByText('Grafana v13.0.0')).toBeInTheDocument();
  });
});
