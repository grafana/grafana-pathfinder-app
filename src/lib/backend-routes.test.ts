import { config } from '@grafana/runtime';
import { backendRoute, usesSdkBackend } from './backend-routes';

jest.mock('@grafana/runtime', () => ({ config: { namespace: 'default', featureToggles: {} } }));

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
