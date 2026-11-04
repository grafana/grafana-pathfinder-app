import { prepareKioskInputs } from './prepare-kiosk-inputs';
import { prepareGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { guideResponseStorage } from '../../lib/user-storage';
import { mockDatasourceList, mockDatasourceListFailure } from '../../test-utils/datasource-list';
import type { KioskInput } from '../../types/kiosk-page.schema';
import type { KioskRule } from './kiosk-rules';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  ...require('../../test-utils/datasource-list').runtimeDatasourceSrvStub,
}));
jest.mock('../docs-panel/utils/prepare-guide-launch', () => ({ prepareGuideLaunch: jest.fn() }));
jest.mock('../../lib/user-storage', () => ({ guideResponseStorage: { mergeResponses: jest.fn() } }));

const rule: KioskRule = {
  title: 'Demo',
  description: '',
  type: 'interactive',
  url: 'https://interactive-learning.grafana.net/packages/demo/content.json',
};
const input: KioskInput = {
  inputType: 'datasource',
  variableName: 'metrics',
  prompt: 'Data source',
  datasourceFilter: 'prometheus',
  required: true,
};
const launch = {
  url: rule.url,
  type: 'docs',
  title: 'Demo',
  source: 'url_param',
  requiresGrafanaUi: true,
  preparedContent: {
    url: rule.url,
    metadata: { title: 'Demo' },
    type: 'interactive',
    lastFetched: '',
    content: JSON.stringify({
      id: 'demo',
      title: 'Demo',
      blocks: [
        { type: 'input', ...input },
        { type: 'markdown', content: '{{metrics}}' },
      ],
    }),
    countingSource: { kind: 'pre-inlining', guideJson: '{}' },
  },
};
const signal = () => new AbortController().signal;

beforeEach(() => {
  jest.clearAllMocks();
  mockDatasourceList([
    { uid: 'prom-1', name: 'Prod metrics', type: 'prometheus' },
    { uid: 'amp-1', name: 'AWS metrics', type: 'grafana-amazonprometheus-datasource' },
    { uid: 'loki-1', name: 'Prod logs', type: 'loki' },
  ]);
  jest.mocked(prepareGuideLaunch).mockResolvedValue({ ok: true, launch } as never);
  jest.mocked(guideResponseStorage.mergeResponses).mockResolvedValue(undefined as never);
});

it.each(['Prod metrics', 'AWS metrics'])('saves an available data source of the filtered type (%s)', async (name) => {
  await expect(prepareKioskInputs(rule, 'instance', [input], { metrics: name }, signal())).resolves.toMatchObject({
    inputTransfer: 'saved',
  });
  expect(guideResponseStorage.mergeResponses).toHaveBeenCalledWith('packages-demo-content.json', { metrics: name });
});

it.each([
  ['a name no data source has', 'Deleted metrics'],
  ['a data source the filter does not offer', 'Prod logs'],
])('rejects %s', async (_label, name) => {
  await expect(prepareKioskInputs(rule, 'instance', [input], { metrics: name }, signal())).rejects.toThrow(
    'Choose an available data source'
  );
  expect(prepareGuideLaunch).not.toHaveBeenCalled();
  expect(guideResponseStorage.mergeResponses).not.toHaveBeenCalled();
});

it('rejects every pick when the data source service fails', async () => {
  mockDatasourceListFailure();
  await expect(prepareKioskInputs(rule, 'instance', [input], { metrics: 'Prod metrics' }, signal())).rejects.toThrow(
    'Choose an available data source'
  );
  expect(guideResponseStorage.mergeResponses).not.toHaveBeenCalled();
});
