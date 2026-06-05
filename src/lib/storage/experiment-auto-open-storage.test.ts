import { StorageKeys } from '../storage-keys';
import { experimentAutoOpenStorage } from './experiment-auto-open-storage';

jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(),
}));

describe('experimentAutoOpenStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('returns defaults when no state has been stored', async () => {
      const state = await experimentAutoOpenStorage.get();
      expect(state).toEqual({ pagesAutoOpened: [], globalAutoOpened: false });
    });

    it('falls back to defaults when stored data fails schema validation', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(StorageKeys.EXPERIMENT_AUTO_OPEN, JSON.stringify({ bogus: true }));

      const state = await experimentAutoOpenStorage.get();

      expect(state).toEqual({ pagesAutoOpened: [], globalAutoOpened: false });
      expect(warnSpy).toHaveBeenCalledWith(
        'Experiment auto-open state validation failed, using defaults:',
        expect.any(Array)
      );
      warnSpy.mockRestore();
    });
  });

  describe('markPageAutoOpened / hasPageAutoOpened', () => {
    it('round-trips a single page pattern through StorageKeys.EXPERIMENT_AUTO_OPEN', async () => {
      await experimentAutoOpenStorage.markPageAutoOpened('/a/grafana-synthetic-monitoring-app');

      expect(await experimentAutoOpenStorage.hasPageAutoOpened('/a/grafana-synthetic-monitoring-app')).toBe(true);
      expect(await experimentAutoOpenStorage.hasPageAutoOpened('/a/other-app')).toBe(false);

      const raw = localStorage.getItem(StorageKeys.EXPERIMENT_AUTO_OPEN);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual({
        pagesAutoOpened: ['/a/grafana-synthetic-monitoring-app'],
        globalAutoOpened: false,
      });
    });

    it('does not add duplicate page patterns', async () => {
      await experimentAutoOpenStorage.markPageAutoOpened('/a/app');
      await experimentAutoOpenStorage.markPageAutoOpened('/a/app');

      const state = await experimentAutoOpenStorage.get();
      expect(state.pagesAutoOpened).toEqual(['/a/app']);
    });

    it('appends additional patterns alongside existing ones', async () => {
      await experimentAutoOpenStorage.markPageAutoOpened('/a/first');
      await experimentAutoOpenStorage.markPageAutoOpened('/a/second');

      const state = await experimentAutoOpenStorage.get();
      expect(state.pagesAutoOpened).toEqual(['/a/first', '/a/second']);
    });
  });

  describe('markGlobalAutoOpened / hasGlobalAutoOpened', () => {
    it('flips and reads the global flag without affecting page patterns', async () => {
      await experimentAutoOpenStorage.markPageAutoOpened('/a/app');
      expect(await experimentAutoOpenStorage.hasGlobalAutoOpened()).toBe(false);

      await experimentAutoOpenStorage.markGlobalAutoOpened();

      expect(await experimentAutoOpenStorage.hasGlobalAutoOpened()).toBe(true);
      const state = await experimentAutoOpenStorage.get();
      expect(state.pagesAutoOpened).toEqual(['/a/app']);
    });
  });

  describe('reset', () => {
    it('overwrites stored state with defaults but keeps the key present', async () => {
      await experimentAutoOpenStorage.markPageAutoOpened('/a/app');
      await experimentAutoOpenStorage.markGlobalAutoOpened();

      await experimentAutoOpenStorage.reset();

      const raw = localStorage.getItem(StorageKeys.EXPERIMENT_AUTO_OPEN);
      expect(JSON.parse(raw!)).toEqual({ pagesAutoOpened: [], globalAutoOpened: false });
    });
  });

  describe('clear', () => {
    it('removes the storage key entirely', async () => {
      await experimentAutoOpenStorage.markPageAutoOpened('/a/app');
      expect(localStorage.getItem(StorageKeys.EXPERIMENT_AUTO_OPEN)).not.toBeNull();

      await experimentAutoOpenStorage.clear();

      expect(localStorage.getItem(StorageKeys.EXPERIMENT_AUTO_OPEN)).toBeNull();
    });
  });
});
