import { launchKioskGuide } from './launch-kiosk-guide';
import { REQUEST_FLOATING_GUIDE_EVENT } from '../../lib/event-names';
import { isExtensionSidebarOwnedByOther } from '../../lib/storage/extension-sidebar';
import type { PreparedGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { panelModeManager } from '../../global-state/panel-mode';
import { StorageKeys } from '../../lib/storage-keys';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { KioskTile } from './KioskTile';
import type { KioskRule } from './kiosk-rules';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';

const mockPush = jest.fn();
jest.mock('@grafana/runtime', () => ({
  config: {},
  getAppEvents: () => ({ publish: jest.fn() }),
  locationService: {
    push: (...args: unknown[]) => mockPush(...args),
    getLocation: () => ({ pathname: '/dashboards', search: '?orgId=2&pathfinderKiosk=1', hash: '' }),
  },
}));

jest.mock('../../lib/storage/extension-sidebar', () => ({ isExtensionSidebarOwnedByOther: jest.fn(() => false) }));

jest.mock('../../utils/dev-mode', () => ({ isDevModeEnabledGlobal: () => false }));

jest.mock('@grafana/ui', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
  useStyles2: () => ({}),
}));

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    KioskDemoStarted: 'kiosk_demo_started',
  },
}));

jest.mock('../../constants/testIds', () => ({
  testIds: {
    kioskMode: {
      tile: (i: number) => `kiosk-tile-${i}`,
      tileTitle: (i: number) => `kiosk-tile-title-${i}`,
    },
  },
}));

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('KioskTile', () => {
  const mockOpen = jest.fn();
  const mockRandomUUID = jest.fn(() => '00000000-0000-4000-a000-000000000001');

  const rule: KioskRule = {
    title: 'First Dashboard',
    url: 'https://interactive-learning.grafana.net/guides/first-dashboard',
    description: 'Build your first dashboard',
    type: 'interactive',
    targetUrl: 'https://play.grafana.org',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    window.open = mockOpen;
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: mockRandomUUID },
      writable: true,
    });
  });

  it('opens deep link with doc and kiosk_session params on click', () => {
    render(<KioskTile rule={rule} index={0} />);
    fireEvent.click(screen.getByTestId('kiosk-tile-0'));

    expect(mockOpen).toHaveBeenCalledTimes(1);
    const openedUrl = new URL(mockOpen.mock.calls[0][0]);
    expect(openedUrl.origin).toBe('https://play.grafana.org');
    expect(openedUrl.searchParams.get('doc')).toBe(rule.url);
    expect(openedUrl.searchParams.get('kiosk_session')).toBe('00000000-0000-4000-a000-000000000001');
    expect(mockOpen.mock.calls[0][1]).toBe('_blank');
    expect(mockOpen.mock.calls[0][2]).toBe('noopener,noreferrer');
  });

  it('fires KioskDemoStarted analytics event before opening the tab', () => {
    render(<KioskTile rule={rule} index={0} />);
    fireEvent.click(screen.getByTestId('kiosk-tile-0'));

    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.KioskDemoStarted, {
      kiosk_session_id: '00000000-0000-4000-a000-000000000001',
      guide_url: rule.url,
      guide_title: rule.title,
      guide_type: rule.type,
      target_instance: rule.targetUrl,
      launch_mode: 'presentation',
    });

    const analyticsCallOrder = (reportAppInteraction as jest.Mock).mock.invocationCallOrder[0]!;
    const openCallOrder = mockOpen.mock.invocationCallOrder[0]!;
    expect(analyticsCallOrder).toBeLessThan(openCallOrder);
  });

  it('falls back to window.location.origin when targetUrl is not set', () => {
    const ruleWithoutTarget: KioskRule = { ...rule, targetUrl: undefined };
    render(<KioskTile rule={ruleWithoutTarget} index={0} />);
    fireEvent.click(screen.getByTestId('kiosk-tile-0'));

    const openedUrl = new URL(mockOpen.mock.calls[0][0]);
    expect(openedUrl.origin).toBe(window.location.origin);

    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.KioskDemoStarted,
      expect.objectContaining({
        target_instance: window.location.origin,
      })
    );
  });

  it('preserves sub-path in targetUrl when building the deep link', () => {
    const ruleWithSubPath: KioskRule = { ...rule, targetUrl: 'https://example.com/grafana' };
    render(<KioskTile rule={ruleWithSubPath} index={0} />);
    fireEvent.click(screen.getByTestId('kiosk-tile-0'));

    const openedUrl = new URL(mockOpen.mock.calls[0][0]);
    expect(openedUrl.pathname).toBe('/grafana/');
    expect(openedUrl.searchParams.get('doc')).toBe(rule.url);
    expect(openedUrl.searchParams.get('kiosk_session')).toBe('00000000-0000-4000-a000-000000000001');
  });

  it('generates a new session ID on each click', () => {
    let callCount = 0;
    mockRandomUUID.mockImplementation(() => {
      callCount++;
      return `00000000-0000-4000-a000-00000000000${callCount}`;
    });

    render(<KioskTile rule={rule} index={0} />);
    const tile = screen.getByTestId('kiosk-tile-0');

    fireEvent.click(tile);
    fireEvent.click(tile);

    const firstUrl = new URL(mockOpen.mock.calls[0][0]);
    const secondUrl = new URL(mockOpen.mock.calls[1][0]);
    expect(firstUrl.searchParams.get('kiosk_session')).not.toBe(secondUrl.searchParams.get('kiosk_session'));
  });

  it('produces a valid UUID v4 format in the kiosk_session param', () => {
    mockRandomUUID.mockReturnValue('550e8400-e29b-41d4-a716-446655440000');

    render(<KioskTile rule={rule} index={1} />);
    fireEvent.click(screen.getByTestId('kiosk-tile-1'));

    const openedUrl = new URL(mockOpen.mock.calls[0][0]);
    expect(openedUrl.searchParams.get('kiosk_session')).toMatch(UUID_REGEX);
  });
  const credentialTarget = new URL('https://example.com');
  credentialTarget.username = 'test-user';
  credentialTarget.password = 'test-password';
  it.each(['javascript:alert(1)', 'data:text/html,test', credentialTarget.href])(
    'rejects unsafe target %s without analytics or navigation',
    (targetUrl) => {
      render(<KioskTile rule={{ ...rule, targetUrl }} index={0} />);
      fireEvent.click(screen.getByTestId('kiosk-tile-0'));
      expect(mockOpen).not.toHaveBeenCalled();
      expect(reportAppInteraction).not.toHaveBeenCalled();
    }
  );
  it('rejects unsafe guide URLs', () => {
    render(<KioskTile rule={{ ...rule, url: 'javascript:alert(1)' }} index={0} />);
    fireEvent.click(screen.getByTestId('kiosk-tile-0'));
    expect(mockOpen).not.toHaveBeenCalled();
  });
  it('opens a guide on the current instance and tab, ignoring presentation targetUrl', () => {
    panelModeManager.setModePersisted('floating');
    const onLaunch = jest.fn();
    render(
      <KioskTile rule={{ ...rule, page: '/explore?left=test#query' }} index={0} mode="instance" onLaunch={onLaunch} />
    );
    fireEvent.click(screen.getByTestId('kiosk-tile-0'));
    expect(mockOpen).not.toHaveBeenCalled();
    expect(onLaunch).toHaveBeenCalledTimes(1);
    const url = new URL(mockPush.mock.calls[0][0], window.location.origin);
    expect(url.pathname).toBe('/explore');
    expect(url.searchParams.get('left')).toBe('test');
    expect(url.searchParams.get('orgId')).toBe('2');
    expect(url.searchParams.get('doc')).toBe(rule.url);
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('panelMode')).toBe(false);
    expect(panelModeManager.getMode()).toBe('sidebar');
    expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('floating');
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.KioskDemoStarted,
      expect.objectContaining({ launch_mode: 'instance', target_instance: window.location.origin })
    );
    expect(url.searchParams.has('pathfinderKiosk')).toBe(false);
    expect(url.hash).toBe('#query');
    expect(onLaunch.mock.invocationCallOrder[0]).toBeLessThan(mockPush.mock.invocationCallOrder[0]!);
  });

  it.each(['floating', 'occupied-sidebar'])('preserves a prepared launch with %s', (surface) => {
    panelModeManager.setModeTransient(surface === 'floating' ? 'floating' : 'sidebar');
    jest.mocked(isExtensionSidebarOwnedByOther).mockReturnValue(surface === 'occupied-sidebar');
    const prepared: PreparedGuideLaunch = {
      url: rule.url,
      title: rule.title,
      type: 'docs',
      source: 'url_param',
      requiresGrafanaUi: true,
      preparedContent: {
        url: rule.url,
        content: '{}',
        type: 'interactive',
        metadata: { title: rule.title },
        lastFetched: '',
        countingSource: { kind: 'pre-inlining', guideJson: '{}' },
      },
    };
    let pending: unknown;
    const listener = () => {
      pending = panelModeManager.consumePendingGuide();
    };
    document.addEventListener(REQUEST_FLOATING_GUIDE_EVENT, listener);
    try {
      launchKioskGuide(rule, 'instance', jest.fn(), prepared);
      expect(panelModeManager.getMode()).toBe('floating');
      expect(pending).toEqual(expect.objectContaining({ url: rule.url, preparedContent: prepared.preparedContent }));
      expect(new URL(mockPush.mock.calls[0][0], window.location.origin).searchParams.has('doc')).toBe(false);
    } finally {
      document.removeEventListener(REQUEST_FLOATING_GUIDE_EVENT, listener);
      jest.mocked(isExtensionSidebarOwnedByOther).mockReturnValue(false);
    }
  });

  it('keeps the current route when no page is specified and forwards learning journeys', () => {
    render(<KioskTile rule={{ ...rule, type: 'learning-journey' }} index={0} mode="instance" />);
    fireEvent.click(screen.getByTestId('kiosk-tile-0'));
    const url = new URL(mockPush.mock.calls[0][0], window.location.origin);
    expect(url.pathname).toBe('/dashboards');
    expect(url.searchParams.get('type')).toBe('learning-journey');
  });

  it.each(['//evil.example.com', '/logout', 'https://evil.example.com'])('rejects unsafe destination %s', (page) => {
    render(<KioskTile rule={{ ...rule, page }} index={0} mode="instance" />);
    fireEvent.click(screen.getByTestId('kiosk-tile-0'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
