import { act, renderHook } from '@testing-library/react';
import { Subject } from 'rxjs';
import { getIsAssistantAvailable } from './assistant-dev-mode';
import { useAssistantGeneration } from './useAssistantGeneration.hook';
import { mockDatasourceList, mockDatasourceListFailure } from '../../test-utils/datasource-list';

const mockLocation = { pathname: '/a/grafana-pathfinder-app', search: {} as Record<string, string> };
const mockSetPageContext = jest.fn();
jest.mock(
  '@grafana/plugin-compat/datasources',
  () => require('../../test-utils/datasource-list').pluginCompatDatasourcesStub
);
jest.mock('@grafana/runtime', () => ({
  locationService: {
    getLocation: () => ({ pathname: mockLocation.pathname }),
    getSearchObject: () => mockLocation.search,
  },
}));

jest.mock('@grafana/assistant', () => ({
  ...jest.requireActual('@grafana/assistant'),
  useInlineAssistant: jest.fn(() => ({})),
  useProvidePageContext: jest.fn(() => mockSetPageContext),
  createAssistantContextItem: (type: string, data: unknown) => ({ type, data }),
}));
jest.mock('./assistant-dev-mode', () => ({
  getIsAssistantAvailable: jest.fn(),
  useMockInlineAssistant: jest.fn(() => ({})),
}));
jest.mock('../../lib/logging', () => ({ logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
jest.mock('../../utils/dev-mode', () => ({ isAssistantDevModeEnabledGlobal: jest.fn(() => false) }));

it('distinguishes a pending availability check from confirmed unavailability and tracks subsequent updates', () => {
  const availability = new Subject<boolean>();
  jest.mocked(getIsAssistantAvailable).mockReturnValue(availability);
  const { result, unmount } = renderHook(() =>
    useAssistantGeneration({ contentKey: 'test-guide', assistantId: 'customize-guide' })
  );
  expect(result.current.isCheckingAssistantAvailability).toBe(true);
  expect(result.current.isAssistantAvailable).toBe(false);
  act(() => availability.next(true));
  expect(result.current.isCheckingAssistantAvailability).toBe(false);
  expect(result.current.isAssistantAvailable).toBe(true);
  act(() => availability.next(false));
  expect(result.current.isCheckingAssistantAvailability).toBe(false);
  expect(result.current.isAssistantAvailable).toBe(false);
  unmount();
  expect(availability.observed).toBe(false);
});

describe('getDatasourceContext', () => {
  const LIST = [
    { uid: 'loki-1', name: 'Prod logs', type: 'loki' },
    { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
    { uid: 'prom-2', name: 'Staging metrics', type: 'prometheus' },
  ];
  const summaries = LIST.map(({ uid, name, type }) => ({ uid, name, type }));

  function getDatasourceContext() {
    jest.mocked(getIsAssistantAvailable).mockReturnValue(new Subject<boolean>());
    const { result } = renderHook(() =>
      useAssistantGeneration({ contentKey: 'test-guide', assistantId: 'customize-guide' })
    );
    return result.current.getDatasourceContext();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockDatasourceList(LIST);
    mockLocation.pathname = '/a/grafana-pathfinder-app';
    mockLocation.search = {};
  });

  it.each([
    ['name', 'Staging metrics'],
    ['uid', 'loki-1'],
  ])('picks the data source open in Explore by %s', async (_key, datasource) => {
    mockLocation.pathname = '/explore';
    mockLocation.search = { left: JSON.stringify({ datasource }) };
    const expected = summaries.find((ds) => ds.name === datasource || ds.uid === datasource)!;

    await expect(getDatasourceContext()).resolves.toEqual({ dataSources: summaries, currentDatasource: expected });
    expect(mockSetPageContext).toHaveBeenCalledWith([{ type: 'datasource', data: { datasourceUid: expected.uid } }]);
  });

  it('falls back to the first Prometheus data source outside Explore', async () => {
    await expect(getDatasourceContext()).resolves.toEqual({
      dataSources: summaries,
      currentDatasource: { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
    });
  });

  it('falls back to Prometheus when the Explore data source is not in the list', async () => {
    mockLocation.pathname = '/explore';
    mockLocation.search = { left: JSON.stringify({ datasource: 'deleted' }) };
    await expect(getDatasourceContext()).resolves.toMatchObject({ currentDatasource: { uid: 'prom-1' } });
  });

  it('reports no current data source when none matches', async () => {
    mockDatasourceList([{ uid: 'loki-1', name: 'Prod logs', type: 'loki' }]);
    await expect(getDatasourceContext()).resolves.toEqual({
      dataSources: [{ uid: 'loki-1', name: 'Prod logs', type: 'loki' }],
      currentDatasource: null,
    });
    expect(mockSetPageContext).not.toHaveBeenCalled();
  });

  it('reports an empty context when the service fails', async () => {
    mockDatasourceListFailure();
    await expect(getDatasourceContext()).resolves.toEqual({ dataSources: [], currentDatasource: null });
  });
});
