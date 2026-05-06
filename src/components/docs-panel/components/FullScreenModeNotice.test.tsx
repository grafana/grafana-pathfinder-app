/**
 * Tests for FullScreenModeNotice — the placeholder rendered in the sidebar
 * content area when fullscreen owns the active session.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FullScreenModeNotice } from './FullScreenModeNotice';
import { testIds } from '../../../constants/testIds';

const mockPush = jest.fn();

jest.mock('@grafana/runtime', () => ({
  locationService: {
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

jest.mock('@grafana/ui', () => {
  const Real = jest.requireActual('react');
  return {
    Button: ({ children, onClick, ...rest }: any) => Real.createElement('button', { onClick, ...rest }, children),
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
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders the title, body, and return button', () => {
    render(<FullScreenModeNotice />);
    expect(screen.getByTestId(testIds.fullScreenMode.notice)).toBeInTheDocument();
    expect(screen.getByText('Pathfinder is in full screen')).toBeInTheDocument();
    expect(screen.getByTestId(testIds.fullScreenMode.noticeReturnButton)).toBeInTheDocument();
  });

  it('pushes the fullscreen route when the return button is clicked (default behaviour)', () => {
    render(<FullScreenModeNotice />);
    fireEvent.click(screen.getByTestId(testIds.fullScreenMode.noticeReturnButton));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/\/fullscreen$/));
  });

  it('invokes the onReturn override when supplied (and skips the route push)', () => {
    const onReturn = jest.fn();
    render(<FullScreenModeNotice onReturn={onReturn} />);
    fireEvent.click(screen.getByTestId(testIds.fullScreenMode.noticeReturnButton));
    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
