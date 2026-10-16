import { config, locationService, createOpenFeatureOFREPWebProvider } from '@grafana/runtime';
import type { ToolInvokeOptions } from '@grafana/assistant';
import { createDatasourceMetadataTool } from './tools/datasource-metadata.tool';
import { createGuideMetadataTool, getGuideCustomizationContext } from './guide-customization-context';

jest.mock('./tools/datasource-metadata.tool', () => ({ createDatasourceMetadataTool: jest.fn() }));
jest.mock('@grafana/runtime', () => ({
  config: {
    bootData: {
      settings: {
        buildInfo: { version: '13.2.2', versionString: 'Grafana Cloud' },
        featureToggles: { queryEditorNext: false },
      },
    },
  },
  createOpenFeatureOFREPWebProvider: jest.fn(() => ({
    resolveBooleanEvaluation: (key: string) =>
      key === 'queryEditorNext'
        ? { value: false, reason: 'STATIC' }
        : { value: false, reason: 'ERROR', errorCode: 'FLAG_NOT_FOUND' },
    onClose: jest.fn().mockResolvedValue(undefined),
  })),
  locationService: { getLocation: jest.fn(() => ({ pathname: '/dashboard/new', search: '?token=private' })) },
}));

const invoke = jest.fn();
const options = {} as ToolInvokeOptions;
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(createDatasourceMetadataTool)
    .mockReturnValue({ invoke } as unknown as ReturnType<typeof createDatasourceMetadataTool>);
  invoke.mockResolvedValue(['Metrics: up', { extra: 'not sent' }]);
});

it('includes version and relevant flags without query parameters or unrelated settings', () => {
  const context = getGuideCustomizationContext();
  expect(context).toMatchObject({
    grafanaVersion: '13.2.2',
    platform: 'cloud',
    currentPath: '/dashboard/new',
    uiFeatures: { dashboardNewLayouts: null, queryEditorNext: false },
  });
  expect(JSON.stringify(context)).not.toContain('private');
  expect(context).not.toHaveProperty('search');
  expect(locationService.getLocation).toHaveBeenCalled();
  expect(config.bootData.settings.featureToggles.queryEditorNext).toBe(false);
});

it('requires an explicit available UID and limits lookups across generation and repair', async () => {
  const onRead = jest.fn();
  const tool = createGuideMetadataTool([{ uid: 'play' }], onRead, () => true);
  expect(await tool.invoke({}, options)).toContain('Specify a datasourceUid');
  expect(await tool.invoke({ datasourceUid: 'other' }, options)).toContain('Specify a datasourceUid');
  expect(invoke).not.toHaveBeenCalled();
  expect(await tool.invoke({ datasourceUid: 'play' }, options)).toBe('Metrics: up');
  await tool.invoke({ datasourceUid: 'play' }, options);
  expect(await tool.invoke({ datasourceUid: 'play' }, options)).toContain('limit reached');
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(onRead).toHaveBeenCalledTimes(2);
});

it('bounds tool content and excludes the unbounded artifact', async () => {
  invoke.mockResolvedValue(['x'.repeat(15000), { secret: 'not context' }]);
  const result = await createGuideMetadataTool([{ uid: 'play' }], jest.fn(), () => true).invoke(
    { datasourceUid: 'play' },
    options
  );
  expect(result).toHaveLength(12028);
  expect(result).toContain('[Metadata sample truncated]');
  expect(result).not.toContain('not context');
});

it('does not look up metadata after cancellation', async () => {
  const tool = createGuideMetadataTool([{ uid: 'play' }], jest.fn(), () => false);
  expect(await tool.invoke({ datasourceUid: 'play' }, options)).toContain('cancelled');
  expect(invoke).not.toHaveBeenCalled();
});

it('drops metadata returned after cancellation', async () => {
  let active = true;
  invoke.mockImplementationOnce(async () => {
    active = false;
    return 'late metadata';
  });
  const tool = createGuideMetadataTool([{ uid: 'play' }], jest.fn(), () => active);
  expect(await tool.invoke({ datasourceUid: 'play' }, options)).toContain('cancelled');
});

it('reports UI flags as unknown on older Grafana without provider APIs', () => {
  jest.mocked(createOpenFeatureOFREPWebProvider).mockReturnValueOnce({
    resolveBooleanEvaluation: () => {
      throw new Error('unavailable');
    },
    onClose: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof createOpenFeatureOFREPWebProvider>);
  expect(getGuideCustomizationContext().uiFeatures).toEqual({ dashboardNewLayouts: null, queryEditorNext: null });
});
