import { prepareKioskInputs } from './prepare-kiosk-inputs';
import { prepareGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { guideResponseStorage } from '../../lib/user-storage';
import { filterDatasourcesByType } from '../interactive-tutorial/datasource-options';
import type { KioskInput } from '../../types/kiosk-page.schema';
import type { KioskRule } from './kiosk-rules';

jest.mock('../docs-panel/utils/prepare-guide-launch', () => ({ prepareGuideLaunch: jest.fn() }));
jest.mock('../../lib/user-storage', () => ({ guideResponseStorage: { mergeResponses: jest.fn() } }));
jest.mock('../interactive-tutorial/datasource-options', () => ({ filterDatasourcesByType: jest.fn(() => []) }));

const rule: KioskRule = {
  title: 'Demo',
  description: '',
  type: 'interactive',
  url: 'https://interactive-learning.grafana.net/packages/demo/content.json',
};
const input: KioskInput = {
  inputType: 'text',
  format: 'http-origin',
  variableName: 'appUrl',
  prompt: 'Website',
  required: true,
};
const draft = { appUrl: 'https://example.com/' };
const signal = () => new AbortController().signal;
const result = () => ({
  ok: true,
  launch: {
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
          { type: 'markdown', content: '{{appUrl}}' },
        ],
      }),
      countingSource: { kind: 'pre-inlining', guideJson: '{}' },
    },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  (prepareGuideLaunch as jest.Mock).mockResolvedValue(result());
  (guideResponseStorage.mergeResponses as jest.Mock).mockResolvedValue(undefined);
});
it('validates and saves before returning the exact prepared payload', async () => {
  const prepared = await prepareKioskInputs(rule, 'instance', [input], draft, signal());
  expect(prepared).toEqual(result().launch);
  expect(prepareGuideLaunch).toHaveBeenCalledWith(rule.url, expect.objectContaining({ requireResolvedSnippets: true }));
  expect(guideResponseStorage.mergeResponses).toHaveBeenCalledWith('packages-demo-content.json', {
    appUrl: 'https://example.com',
  });
});
it('rejects other instances and presentation mode without fetching', async () => {
  await expect(prepareKioskInputs(rule, 'presentation', [input], draft, signal())).rejects.toThrow('instance');
  await expect(
    prepareKioskInputs({ ...rule, targetUrl: 'https://other.example' }, 'instance', [input], draft, signal())
  ).rejects.toThrow('instance');
  expect(prepareGuideLaunch).not.toHaveBeenCalled();
});
it('does not save after cancellation or fetch failure', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(prepareKioskInputs(rule, 'instance', [input], draft, controller.signal)).rejects.toThrow();
  (prepareGuideLaunch as jest.Mock).mockResolvedValue({ ok: false });
  await expect(prepareKioskInputs(rule, 'instance', [input], draft, signal())).rejects.toThrow('validated');
  expect(guideResponseStorage.mergeResponses).not.toHaveBeenCalled();
});
it('does not return a launch when persistence fails or expose storage error details', async () => {
  (guideResponseStorage.mergeResponses as jest.Mock).mockRejectedValue(new Error('private input'));
  await expect(prepareKioskInputs(rule, 'instance', [input], draft, signal())).rejects.toThrow(
    'Could not save inputs. Try again'
  );
});
it('rejects inputs not in the destination and unavailable data sources', async () => {
  await expect(
    prepareKioskInputs(rule, 'instance', [{ ...input, variableName: 'unknown' }], { unknown: draft.appUrl }, signal())
  ).rejects.toThrow('compatible');
  await expect(
    prepareKioskInputs(
      rule,
      'instance',
      [{ ...input, inputType: 'datasource', format: undefined }],
      { appUrl: 'missing' },
      signal()
    )
  ).rejects.toThrow('data source');
  expect(filterDatasourcesByType).toHaveBeenCalled();
  expect(guideResponseStorage.mergeResponses).not.toHaveBeenCalled();
});
