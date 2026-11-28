import { of, throwError } from 'rxjs';
import { config, getBackendSrv } from '@grafana/runtime';
import { backendRoute, discoverSdkBackend, expectsSdkBackend, usesSdkBackend } from './backend-routes';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
  config: { namespace: 'default', featureToggles: {} },
}));

beforeEach(() => {
  config.namespace = 'default';
  config.featureToggles = {};
});

it('never falls back to legacy transport without SDK registration', () => {
  expect(usesSdkBackend()).toBe(false);
  expect(backendRoute('custom-guide')).toBe(
    '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/backend/custom-guide'
  );
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
  expect(usesSdkBackend()).toBe(false);
  expect(expectsSdkBackend()).toBe(true);
  expect(backendRoute('pathfinder-settings')).toContain(`/namespaces/${namespace}/backend/pathfinder-settings`);
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

it.each(['', '*'])('rejects missing or wildcard namespace %s', (namespace) => {
  config.namespace = namespace;
  expect(() => backendRoute('health')).toThrow('SDK backend namespace is unavailable');
});

it('uses plugin settings only after an older self-hosted Grafana confirms a missing SDK route', async () => {
  config.namespace = 'org-45';
  Object.assign(config, { buildInfo: { version: '13.2.6' } });
  Object.assign(config.featureToggles, { 'appplugins.loadAppManifest': true, 'appplugins.registerAPIServer': true });
  const fetch = jest
    .fn()
    .mockReturnValueOnce(throwError(() => ({ status: 503 })))
    .mockReturnValueOnce(throwError(() => ({ status: 404 })))
    .mockReturnValueOnce(throwError(() => ({ status: 503 })))
    .mockReturnValueOnce(of({ data: { status: 'ok' } }));
  jest.mocked(getBackendSrv).mockReturnValue({ fetch } as unknown as ReturnType<typeof getBackendSrv>);
  await discoverSdkBackend();
  expect(expectsSdkBackend()).toBe(true);
  await discoverSdkBackend();
  expect(expectsSdkBackend()).toBe(false);
  await discoverSdkBackend();
  expect(expectsSdkBackend()).toBe(false);
  await discoverSdkBackend();
  expect(usesSdkBackend()).toBe(true);
});

it.each([
  ['stacks-45', '13.2.6'],
  ['org-46', '13.3.0'],
  ['org-47', 'unknown'],
])('keeps SDK storage authoritative after a 404 on %s running %s', async (namespace, version) => {
  config.namespace = namespace;
  Object.assign(config, { buildInfo: { version } });
  Object.assign(config.featureToggles, { 'appplugins.loadAppManifest': true, 'appplugins.registerAPIServer': true });
  const fetch = jest.fn().mockReturnValue(throwError(() => ({ status: 404 })));
  jest.mocked(getBackendSrv).mockReturnValue({ fetch } as unknown as ReturnType<typeof getBackendSrv>);
  await discoverSdkBackend();
  expect(usesSdkBackend()).toBe(false);
  expect(expectsSdkBackend()).toBe(true);
});
