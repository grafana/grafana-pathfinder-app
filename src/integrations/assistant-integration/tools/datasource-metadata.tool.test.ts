import type { ToolInvokeOptions } from '@grafana/assistant';

import { createDatasourceMetadataTool } from './datasource-metadata.tool';
import { fetchPrometheusMetadata } from './utils/prometheus.utils';
import { getInstanceMock, mockDatasourceList } from '../../../test-utils/datasource-list';

jest.mock('@grafana/runtime', () => require('../../../test-utils/datasource-list').runtimeDatasourceSrvStub);
jest.mock('@grafana/assistant', () => ({
  createTool: (
    invoke: (input: unknown, options: unknown) => unknown,
    spec: { validate: (input: unknown) => unknown }
  ) => ({
    ...spec,
    invoke: (input: unknown, options: unknown) => invoke(spec.validate(input), options),
  }),
}));
jest.mock('./utils/prometheus.utils', () => ({ fetchPrometheusMetadata: jest.fn() }));
jest.mock('./utils/loki.utils', () => ({ fetchLokiMetadata: jest.fn() }));
jest.mock('./utils/tempo.utils', () => ({ fetchTempoMetadata: jest.fn() }));
jest.mock('./utils/pyroscope.utils', () => ({ fetchPyroscopeMetadata: jest.fn() }));

type Invokable = { invoke: (input: unknown, options: ToolInvokeOptions) => Promise<unknown> };

function invoke(input: Record<string, unknown> = {}, onArtifact?: jest.Mock) {
  const tool = createDatasourceMetadataTool(onArtifact) as unknown as Invokable;
  return tool.invoke(input, {} as ToolInvokeOptions);
}

beforeEach(() => jest.clearAllMocks());

it('names the supported types when no supported data source exists', async () => {
  mockDatasourceList([{ uid: 'mysql-1', name: 'Reporting', type: 'mysql' }]);
  await expect(invoke()).resolves.toBe(
    'No supported datasources found. Supported types: Prometheus, Loki, Tempo, Pyroscope.'
  );
  expect(getInstanceMock).not.toHaveBeenCalled();
});

it('lists the available supported types when the requested type is absent', async () => {
  mockDatasourceList([
    { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
    { uid: 'tempo-1', name: 'Traces', type: 'tempo' },
    { uid: 'mysql-1', name: 'Reporting', type: 'mysql' },
  ]);
  await expect(invoke({ datasourceType: 'loki' })).resolves.toBe(
    'No loki datasource found. Available types: prometheus, tempo'
  );
});

it('reports an unknown uid as not found', async () => {
  mockDatasourceList([{ uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' }]);
  await expect(invoke({ datasourceUid: 'deleted' })).resolves.toBe('Could not find the specified datasource.');
  expect(getInstanceMock).not.toHaveBeenCalled();
});

it('fetches metadata from the instance of the matched data source', async () => {
  mockDatasourceList([
    { uid: 'mysql-1', name: 'Reporting', type: 'mysql' },
    { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
  ]);
  const instance = { uid: 'prom-1', name: 'instance' };
  getInstanceMock.mockResolvedValueOnce(instance);
  jest.mocked(fetchPrometheusMetadata).mockResolvedValue({ labels: { job: ['api'] }, metrics: ['up'] } as never);
  const onArtifact = jest.fn();

  const [text, artifact] = (await invoke({}, onArtifact)) as [string, unknown];

  expect(getInstanceMock).toHaveBeenCalledWith('prom-1');
  expect(fetchPrometheusMetadata).toHaveBeenCalledWith(instance);
  expect(artifact).toEqual({
    datasource: { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
    metadata: { labels: { job: ['api'] }, metrics: ['up'] },
    summary: 'Found 1 labels and 1 metrics',
  });
  expect(onArtifact).toHaveBeenCalledWith(artifact);
  expect(text).toContain('Datasource: Prod metrics (prometheus)');
});
