import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpFooter } from './HelpFooter';
import { testIds } from '../../constants/testIds';

const mockShortcutsClick = jest.fn();

jest.mock('@grafana/runtime', () => ({
  useHelpNavItem: () => ({
    subTitle: 'Grafana v13.0.0',
    children: [
      { id: 'documentation', text: 'Documentation', icon: 'book', url: 'https://grafana.com/docs/' },
      { id: 'shortcuts', text: 'Keyboard shortcuts', icon: 'keyboard', onClick: mockShortcutsClick },
      { id: 'blog', text: 'Blog', url: 'https://grafana.com/blog/', target: '_self' },
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

  it('uses the explicit target and falls back to _blank', () => {
    render(<HelpFooter />);

    expect(screen.getByRole('link', { name: 'Blog' })).toHaveAttribute('target', '_self');
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('target', '_blank');
  });

  it('does not apply the compact override class to links but keeps it on callback buttons', () => {
    render(<HelpFooter />);

    const link = screen.getByRole('link', { name: 'Documentation' });
    const button = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    expect(button).toHaveStyle({ fontSize: '11.5px', borderWidth: '0px' });
    expect(link).not.toHaveStyle({ fontSize: '11.5px' });
  });

  it('invokes the callback once per click', () => {
    mockShortcutsClick.mockClear();
    render(<HelpFooter />);

    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(mockShortcutsClick).toHaveBeenCalledTimes(1);
  });
});
