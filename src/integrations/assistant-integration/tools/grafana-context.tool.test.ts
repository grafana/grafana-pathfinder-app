import type { ToolInvokeOptions } from '@grafana/assistant';

import { createGrafanaContextTool } from './grafana-context.tool';
import type { GrafanaContextArtifact } from './types';
import { mockDatasourceList, mockDatasourceListFailure } from '../../../test-utils/datasource-list';

jest.mock('@grafana/runtime', () => ({
  ...require('../../../test-utils/datasource-list').runtimeDatasourceSrvStub,
  config: { bootData: { settings: { buildInfo: { version: '13.2.0' } }, user: { orgRole: 'Editor' } }, theme2: {} },
  locationService: {
    getLocation: () => ({ pathname: '/explore', search: '', hash: '' }),
    getSearchObject: () => ({}),
  },
  getBackendSrv: () => ({ get: jest.fn() }),
}));
jest.mock('@grafana/assistant', () => ({
  createTool: (invoke: (input: unknown, options: unknown) => unknown, spec: object) => ({
    ...spec,
    invoke: (input: unknown, options: unknown) => invoke(input, options),
  }),
}));
jest.mock('../../../context-engine', () => ({
  getDetectedDatasourceType: () => null,
  getDetectedVisualizationType: () => null,
}));
jest.mock('../../../lib/platform', () => ({ currentPlatform: () => 'oss' }));
jest.mock('../../../lib/logging', () => ({ logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

type Invokable = { invoke: (input: unknown, options: ToolInvokeOptions) => Promise<[string, GrafanaContextArtifact]> };

async function invoke() {
  const onArtifact = jest.fn();
  const tool = createGrafanaContextTool(onArtifact) as unknown as Invokable;
  const [text, artifact] = await tool.invoke({}, {} as ToolInvokeOptions);
  expect(onArtifact).toHaveBeenCalledWith(artifact);
  return { text, artifact };
}

it('reports each data source as uid, name and type only', async () => {
  mockDatasourceList([
    { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus', meta: { builtIn: false } },
    { uid: 'loki-1', name: 'Prod logs', type: 'loki' },
  ]);
  const { text, artifact } = await invoke();
  expect(artifact.datasources).toEqual([
    { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
    { uid: 'loki-1', name: 'Prod logs', type: 'loki' },
  ]);
  expect(text).toContain('  prometheus: Prod metrics');
  expect(text).toContain('  loki: Prod logs');
});

it('reports no data sources rather than failing when the service throws', async () => {
  mockDatasourceListFailure();
  const { text, artifact } = await invoke();
  expect(artifact.datasources).toEqual([]);
  expect(text).toContain('No datasources configured');
});
