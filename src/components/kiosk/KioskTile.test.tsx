import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { KioskTile } from './KioskTile';
import type { KioskRule } from './kiosk-rules';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';

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
});
