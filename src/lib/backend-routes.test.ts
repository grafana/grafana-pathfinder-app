import { of, throwError } from 'rxjs';
import { config, getBackendSrv } from '@grafana/runtime';
import { backendRoute, discoverSdkBackend, usesSdkBackend } from './backend-routes';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
  config: { namespace: 'default', featureToggles: {} },
}));

beforeEach(() => {
  config.namespace = 'default';
  config.featureToggles = {};
});

it('retains legacy transport without SDK registration', () => {
  expect(usesSdkBackend()).toBe(false);
  expect(backendRoute('custom-guide')).toBe('/api/plugins/grafana-pathfinder-app/resources/custom-guide');
});

it('rejects unapproved paths even when supplied outside TypeScript', () => {
  for (const route of ['../interactiveguides', 'custom-guide?user=other', '/health', '']) {
    expect(() => backendRoute(route as Parameters<typeof backendRoute>[0])).toThrow('Unknown backend route');
  }
});

it.each<[string, boolean]>([
  ['default', true],
  ['stacks-9239', true],
  ['stacks-22', false],
])('checks SDK health in %s with registration flags %s', async (namespace, flagsEnabled) => {
  config.namespace = namespace;
  Object.assign(config.featureToggles, {
    'appplugins.loadAppManifest': flagsEnabled,
    'appplugins.registerAPIServer': flagsEnabled,
  });
  const fetch = jest
    .fn()
    .mockReturnValueOnce(throwError(() => new Error('404')))
    .mockReturnValueOnce(of({ data: { status: 'ok' } }));
  jest.mocked(getBackendSrv).mockReturnValue({ fetch } as unknown as ReturnType<typeof getBackendSrv>);
  await discoverSdkBackend();
  expect(backendRoute('custom-guide')).toBe('/api/plugins/grafana-pathfinder-app/resources/custom-guide');
  expect(backendRoute('pathfinder-settings')).toBe('/api/plugins/grafana-pathfinder-app/resources/pathfinder-settings');
  await discoverSdkBackend();
  expect(fetch).toHaveBeenCalledWith(
    expect.objectContaining({
      url: `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${namespace}/backend/health`,
    })
  );
  expect(backendRoute('custom-guide')).toContain(`/namespaces/${namespace}/backend/custom-guide`);
  config.namespace = 'stacks-999';
  expect(usesSdkBackend()).toBe(false);
});
