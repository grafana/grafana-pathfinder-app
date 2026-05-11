/**
 * Tests for FullScreenModeNotice — the placeholder rendered in the sidebar
 * content area when fullscreen owns the active session.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FullScreenModeNotice } from './FullScreenModeNotice';
import { testIds } from '../../../constants/testIds';
import { panelModeManager } from '../../../global-state/panel-mode';
import { locationService } from '@grafana/runtime';
import { PLUGIN_BASE_URL, ROUTES } from '../../../constants';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

jest.mock('@grafana/runtime', () => ({
  locationService: { push: jest.fn() },
}));

jest.mock('@grafana/ui', () => {
  const Real = jest.requireActual('react');
  return {
    Icon: ({ name, ...rest }: any) => Real.createElement('span', { 'aria-label': name, ...rest }, name),
    Button: ({ children, onClick, ...rest }: any) => Real.createElement('button', { onClick, ...rest }, children),
    useStyles2: (fn: any) =>
      fn({
        spacing: () => '8px',
        typography: { h5: {}, bodySmall: {}, fontWeightMedium: 500 },
        colors: { text: {}, background: {}, border: {} },
        shape: { radius: {} },
      }),
  };
});

// jsdom's `window.location` is read-only via defineProperty, but
// `history.pushState` updates the live `pathname`/`search` accessors —
// which is what `FullScreenModeNotice` reads.
function setPathname(pathname: string) {
  window.history.pushState({}, '', pathname);
}

describe('FullScreenModeNotice', () => {
  const ORIGINAL_PATHNAME = window.location.pathname + window.location.search;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    setPathname(ORIGINAL_PATHNAME || '/');
  });

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

  it('renders the "Return to sidebar" CTA so the user can dismount fullscreen from inside the sidebar', () => {
    render(<FullScreenModeNotice />);
    expect(screen.getByTestId(testIds.fullScreenMode.noticeReturnButton)).toBeInTheDocument();
    expect(screen.getByText('Return to sidebar')).toBeInTheDocument();
  });

  it('switches panelMode back to sidebar when the CTA is clicked (and skips navigation when not on /fullscreen)', () => {
    const setModeSpy = jest.spyOn(panelModeManager, 'setMode');
    const consumePriorPathSpy = jest.spyOn(panelModeManager, 'consumePriorPath');
    const pushSpy = locationService.push as jest.Mock;

    // jsdom default URL is http://localhost/ — not /fullscreen
    render(<FullScreenModeNotice />);
    fireEvent.click(screen.getByTestId(testIds.fullScreenMode.noticeReturnButton));

    expect(setModeSpy).toHaveBeenCalledWith('sidebar');
    expect(pushSpy).not.toHaveBeenCalled();
    expect(consumePriorPathSpy).not.toHaveBeenCalled();
  });

  it('navigates back to the prior path when clicked on the /fullscreen route', () => {
    const setModeSpy = jest.spyOn(panelModeManager, 'setMode');
    const consumePriorPathSpy = jest.spyOn(panelModeManager, 'consumePriorPath').mockReturnValue('/dashboards/foo');
    const pushSpy = locationService.push as jest.Mock;
    setPathname(`${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`);

    render(<FullScreenModeNotice />);
    fireEvent.click(screen.getByTestId(testIds.fullScreenMode.noticeReturnButton));

    expect(setModeSpy).toHaveBeenCalledWith('sidebar');
    expect(consumePriorPathSpy).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith('/dashboards/foo');
  });

  it('falls back to plugin home when no prior path was captured', () => {
    jest.spyOn(panelModeManager, 'consumePriorPath').mockReturnValue(null);
    const pushSpy = locationService.push as jest.Mock;
    setPathname(`${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`);

    render(<FullScreenModeNotice />);
    fireEvent.click(screen.getByTestId(testIds.fullScreenMode.noticeReturnButton));
    expect(pushSpy).toHaveBeenCalledWith(PLUGIN_BASE_URL);
  });
});
