/**
 * The loader keeps navigation-listener registration synchronous while the
 * handler chunk loads on demand:
 *   - `installDeepLinkNavListener` wires `history.listen` (primary) and falls
 *     back to `popstate` when `locationService.getHistory()` throws.
 *   - The handler is imported only when the URL carries a Pathfinder param.
 */

const mockHistoryListen = jest.fn().mockReturnValue(() => {});
let mockGetHistoryImpl: () => { listen: typeof mockHistoryListen } | null = () => ({ listen: mockHistoryListen });
const mockHandle = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('@grafana/runtime', () => ({
  locationService: {
    getHistory: () => mockGetHistoryImpl(),
  },
}));

jest.mock('../lib/logging', () => ({
  logger: { error: (...args: unknown[]) => mockLoggerError(...args) },
}));

jest.mock('./pathfinder-deep-link-handler', () => ({
  handlePathfinderDeepLink: (...args: unknown[]) => mockHandle(...args),
}));

import { handlePathfinderDeepLink, installDeepLinkNavListener } from './pathfinder-deep-link-loader';

const deps = { attemptAutoOpen: jest.fn() };

const setSearch = (search: string) => {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState({}, '', url.toString());
};

const flushPromises = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  setSearch('');
  mockGetHistoryImpl = () => ({ listen: mockHistoryListen });
});

describe('handlePathfinderDeepLink', () => {
  it('does not load the handler when the URL has no Pathfinder params', async () => {
    setSearch('?tab=overview');
    handlePathfinderDeepLink(deps);
    await flushPromises();
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('delegates to the handler when the URL carries ?doc=', async () => {
    setSearch('?doc=bundled%3Afoo');
    handlePathfinderDeepLink(deps);
    await flushPromises();
    expect(mockHandle).toHaveBeenCalledWith(deps);
  });
});

describe('installDeepLinkNavListener', () => {
  it('registers history.listen synchronously', () => {
    installDeepLinkNavListener(deps);
    expect(mockHistoryListen).toHaveBeenCalledTimes(1);
  });

  it('falls back to popstate only when locationService.getHistory throws', () => {
    mockGetHistoryImpl = () => {
      throw new Error('not available');
    };
    const popstateSpy = jest.spyOn(window, 'addEventListener');

    installDeepLinkNavListener(deps);

    expect(popstateSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
    popstateSpy.mockRestore();
  });

  it('re-runs the handler when the URL changes to include ?doc=', async () => {
    installDeepLinkNavListener(deps);
    const historyHandler = mockHistoryListen.mock.calls[0][0] as () => void;

    setSearch('?tab=overview');
    historyHandler();
    await flushPromises();
    expect(mockHandle).not.toHaveBeenCalled();

    setSearch('?doc=bundled%3Afoo');
    historyHandler();
    await flushPromises();
    expect(mockHandle).toHaveBeenCalledWith(deps);
  });
});
