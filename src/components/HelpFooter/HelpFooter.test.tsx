import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LinkButton } from '@grafana/ui';
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

  it('keeps the compact override class on callback buttons', () => {
    render(<HelpFooter />);

    const button = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    expect(button).toHaveStyle({ fontSize: '11.5px', borderWidth: '0px' });
  });

  it('renders href-backed controls with the text fill appearance', () => {
    const reference = (fill: 'text' | 'solid') => {
      const { container, unmount } = render(
        <LinkButton variant="secondary" size="sm" fill={fill} href="https://example.com">
          ref
        </LinkButton>
      );
      const { className } = container.querySelector('a')!;
      unmount();
      return className;
    };

    const textClass = reference('text');
    const solidClass = reference('solid');
    render(<HelpFooter />);
    const footerClass = screen.getByRole('link', { name: 'Documentation' }).className;

    expect(textClass).not.toEqual(solidClass);
    expect(footerClass).toEqual(textClass);
  });

  it('invokes the callback once per click', () => {
    mockShortcutsClick.mockClear();
    render(<HelpFooter />);

    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(mockShortcutsClick).toHaveBeenCalledTimes(1);
  });
});
