import { sidebarState } from './sidebar';
import { EXTENSION_SIDEBAR_DOCKED_KEY } from '../lib/storage/extension-sidebar';

const mockPublish = jest.fn();
jest.mock('@grafana/runtime', () => ({ getAppEvents: () => ({ publish: mockPublish }) }));
jest.mock('../lib/analytics', () => ({ reportAppInteraction: jest.fn(), UserInteraction: {} }));
jest.mock('./panel-mode', () => ({ panelModeManager: {} }));
jest.mock('./auto-launch', () => ({ autoLaunchChannel: {} }));

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
  mockPublish.mockReset();
});

it('clears persisted docking after requesting close so reload cannot restore the panel', () => {
  mockPublish.mockImplementation(() => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, 'docked');
  });
  localStorage.setItem('unrelated', 'keep');
  sidebarState.requestCloseSidebar();
  expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ type: 'close-extension-sidebar' }));
  expect(localStorage.getItem(EXTENSION_SIDEBAR_DOCKED_KEY)).toBeNull();
  expect(localStorage.getItem('unrelated')).toBe('keep');
});

it('still requests close when storage is unavailable', () => {
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  expect(() => sidebarState.requestCloseSidebar()).not.toThrow();
  expect(mockPublish).toHaveBeenCalledTimes(1);
});
