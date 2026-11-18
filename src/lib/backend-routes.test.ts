import { of, throwError } from 'rxjs';
import { config, getBackendSrv } from '@grafana/runtime';
import { backendRoute, discoverCloudSdkBackend, usesSdkBackend } from './backend-routes';

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

it('selects the namespace-bound SDK transport when both registration flags are enabled', () => {
  Object.assign(config.featureToggles, { 'appplugins.loadAppManifest': true, 'appplugins.registerAPIServer': true });
  config.namespace = 'org-2';
  expect(backendRoute('custom-guide')).toBe(
    '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/org-2/backend/custom-guide'
  );
  config.namespace = '';
  expect(usesSdkBackend()).toBe(false);
});

it('selects the Cloud SDK only when the namespaced health route is ready', async () => {
  config.namespace = 'stacks-9239';
  const fetch = jest
    .fn()
    .mockReturnValueOnce(throwError(() => new Error('404')))
    .mockReturnValueOnce(of({ data: { status: 'ok' } }));
  jest.mocked(getBackendSrv).mockReturnValue({ fetch } as unknown as ReturnType<typeof getBackendSrv>);
  await discoverCloudSdkBackend();
  expect(usesSdkBackend()).toBe(false);
  await discoverCloudSdkBackend();
  expect(fetch).toHaveBeenCalledWith(
    expect.objectContaining({
      url: '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-9239/backend/health',
    })
  );
  expect(backendRoute('custom-guide')).toContain('/namespaces/stacks-9239/backend/custom-guide');
  config.namespace = 'stacks-22';
  expect(usesSdkBackend()).toBe(false);
});
