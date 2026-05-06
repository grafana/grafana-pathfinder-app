/**
 * Tests for FullScreenModeNotice — the placeholder rendered in the sidebar
 * content area when fullscreen owns the active session.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { FullScreenModeNotice } from './FullScreenModeNotice';
import { testIds } from '../../../constants/testIds';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

jest.mock('@grafana/ui', () => {
  const Real = jest.requireActual('react');
  return {
    Icon: ({ name, ...rest }: any) => Real.createElement('span', { 'aria-label': name, ...rest }, name),
    useStyles2: (fn: any) =>
      fn({
        spacing: () => '8px',
        typography: { h5: {}, bodySmall: {}, fontWeightMedium: 500 },
        colors: { text: {}, background: {}, border: {} },
        shape: { radius: {} },
      }),
  };
});

describe('FullScreenModeNotice', () => {
  it('renders the icon, title, and informational body', () => {
    render(<FullScreenModeNotice />);
    expect(screen.getByTestId(testIds.fullScreenMode.notice)).toBeInTheDocument();
    expect(screen.getByText('Pathfinder is in full screen')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Switch tabs in the sidebar to queue what shows the next time you return to the full-screen page.'
      )
    ).toBeInTheDocument();
  });

  it('renders no action buttons (the user is already in full-screen on the dedicated route)', () => {
    render(<FullScreenModeNotice />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
