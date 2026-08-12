/**
 * Hardening tests for the datasource metadata tool.
 *
 * The unpinned form lets the model name a data source, which is what the
 * customize path wants. A data check pins it, and these tests pin that pin:
 * metadata from an unselected data source must never reach a verdict.
 */

import { createDatasourceMetadataTool } from './datasource-metadata.tool';

const mockGetList = jest.fn();
const mockGet = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ getList: mockGetList, get: mockGet }),
}));

jest.mock('./utils/prometheus.utils', () => ({
  fetchPrometheusMetadata: jest.fn(async () => ({ labels: { job: ['api'] }, metrics: ['up'] })),
}));
jest.mock('./utils/loki.utils', () => ({ fetchLokiMetadata: jest.fn(async () => ({ labels: {} })) }));
jest.mock('./utils/tempo.utils', () => ({
  fetchTempoMetadata: jest.fn(async () => ({ services: [], operations: [], tags: [] })),
}));
jest.mock('./utils/pyroscope.utils', () => ({
  fetchPyroscopeMetadata: jest.fn(async () => ({ profileTypes: [], labels: {} })),
}));

// createTool is the SDK's wrapper; the pinning lives in the handler we pass it,
// so hand the pair straight back and invoke the handler directly.
jest.mock('@grafana/assistant', () => ({
  createTool: (handler: any, config: any) => ({ handler, config }),
}));

interface CapturedTool {
  handler: (input: unknown, options: unknown) => Promise<unknown>;
  config: { name: string; description: string; inputSchema: any };
}

function buildTool(options?: { pinnedDatasourceUid?: string }) {
  const { handler, config } = createDatasourceMetadataTool(undefined, options) as unknown as CapturedTool;
  return { invoke: (input: unknown) => handler(input, {}), config };
}

/** The artifact rides in slot 1 of a content_and_artifact tool output. */
function artifactOf(output: unknown) {
  return (output as [string, { datasource: { uid: string } }])[1];
}

beforeEach(() => {
  mockGetList.mockReset();
  mockGet.mockReset();
  mockGetList.mockReturnValue([
    { uid: 'chosen-uid', name: 'Chosen', type: 'prometheus' },
    { uid: 'other-uid', name: 'Other', type: 'prometheus' },
  ]);
  mockGet.mockResolvedValue({});
});

describe('createDatasourceMetadataTool', () => {
  describe('pinned to one data source', () => {
    it('reads the pinned uid rather than the one the model named', async () => {
      const { invoke } = buildTool({ pinnedDatasourceUid: 'chosen-uid' });

      const output = await invoke({ datasourceUid: 'other-uid' });

      expect(artifactOf(output).datasource.uid).toBe('chosen-uid');
    });

    it('ignores a datasource type the model tries to steer with', async () => {
      mockGetList.mockReturnValue([
        { uid: 'chosen-uid', name: 'Chosen', type: 'prometheus' },
        { uid: 'loki-uid', name: 'Logs', type: 'loki' },
      ]);
      const { invoke } = buildTool({ pinnedDatasourceUid: 'chosen-uid' });

      const output = await invoke({ datasourceType: 'loki' });

      expect(artifactOf(output).datasource.uid).toBe('chosen-uid');
    });

    it('offers the model no input to choose with', () => {
      const { config } = buildTool({ pinnedDatasourceUid: 'chosen-uid' });

      expect(config.inputSchema.properties).toEqual({});
      expect(config.inputSchema.additionalProperties).toBe(false);
    });

    it('tells the model the data source is fixed', () => {
      const { config } = buildTool({ pinnedDatasourceUid: 'chosen-uid' });

      expect(config.description).toContain('cannot choose the data source');
    });
  });

  describe('unpinned', () => {
    it('honours the datasource the model names', async () => {
      const { invoke } = buildTool();

      const output = await invoke({ datasourceUid: 'other-uid' });

      expect(artifactOf(output).datasource.uid).toBe('other-uid');
    });

    it('still advertises the uid and type inputs', () => {
      const { config } = buildTool();

      expect(Object.keys(config.inputSchema.properties)).toEqual(['datasourceUid', 'datasourceType']);
    });
  });
});
