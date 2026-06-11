import { renderHook } from '@testing-library/react';

import { panelModeManager } from '../../../global-state/panel-mode';
import { isModalCoexistenceSupported } from '../../../lib/grafana-version';

import { useCompanionMode } from './use-companion-mode';

jest.mock('../../../lib/grafana-version', () => ({
  isModalCoexistenceSupported: jest.fn(),
}));

const mockSupported = isModalCoexistenceSupported as jest.Mock;

let dispatchSpy: jest.SpyInstance;
const dispatchedTypes = () => dispatchSpy.mock.calls.map((c) => (c[0] as Event).type);

const ACTIVE = { companion: true, isActive: true, isCompleted: false, isPreviewMode: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockSupported.mockReturnValue(true);
  jest.spyOn(panelModeManager, 'getMode').mockReturnValue('sidebar');
  dispatchSpy = jest.spyOn(document, 'dispatchEvent');
});

afterEach(() => jest.restoreAllMocks());

describe('useCompanionMode', () => {
  it('pops the panel out when supported + companion section is active + docked', () => {
    renderHook(() => useCompanionMode(ACTIVE));
    expect(dispatchedTypes()).toContain('pathfinder-request-pop-out');
  });

  it('is a no-op when modal coexistence is unsupported (the version gate)', () => {
    mockSupported.mockReturnValue(false);
    renderHook(() => useCompanionMode(ACTIVE));
    expect(dispatchedTypes()).not.toContain('pathfinder-request-pop-out');
  });

  it('is a no-op when companion is false or in preview mode', () => {
    renderHook(() => useCompanionMode({ ...ACTIVE, companion: false }));
    renderHook(() => useCompanionMode({ ...ACTIVE, isPreviewMode: true }));
    expect(dispatchedTypes()).not.toContain('pathfinder-request-pop-out');
  });

  it('docks back on unmount when it owns the floating panel', () => {
    const { unmount } = renderHook(() => useCompanionMode(ACTIVE));
    dispatchSpy.mockClear();
    unmount();
    expect(dispatchedTypes()).toContain('pathfinder-request-dock');
  });

  it('does not dock a panel the user already had floating', () => {
    (panelModeManager.getMode as jest.Mock).mockReturnValue('floating');
    const { unmount } = renderHook(() => useCompanionMode(ACTIVE));
    expect(dispatchedTypes()).not.toContain('pathfinder-request-pop-out');
    dispatchSpy.mockClear();
    unmount();
    expect(dispatchedTypes()).not.toContain('pathfinder-request-dock');
  });
});
