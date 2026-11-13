let mockToggles: Record<string, boolean> = {};

jest.mock('@grafana/runtime', () => ({
  config: {
    namespace: 'stacks-1',
    get featureToggles() {
      return mockToggles;
    },
  },
}));

import { APP_PLATFORM_API_VERSION, collectionUrl, isBackendApiAvailable, itemUrl } from './interactive-guides-api';

const GAP_TOGGLE = 'aggregation.pathfinderbackend-ext-grafana-app.enabled';

beforeEach(() => {
  mockToggles = {};
});

describe('isBackendApiAvailable', () => {
  it('requires SDK registration', () => {
    mockToggles = { 'appplugins.loadAppManifest': true, 'appplugins.registerAPIServer': true };
    expect(isBackendApiAvailable()).toBe(true);
  });

  it('does not enable SDK routes for manifest-only aggregation', () => {
    mockToggles = { [GAP_TOGGLE]: true };
    expect(isBackendApiAvailable()).toBe(false);
  });

  it('is false when the toggle is absent', () => {
    expect(isBackendApiAvailable()).toBe(false);
  });

  it('does not treat the legacy CAP toggle as availability', () => {
    mockToggles = { 'aggregation.pathfinderbackend-ext-grafana-com.enabled': true };
    expect(isBackendApiAvailable()).toBe(false);
  });
});

describe('url builders', () => {
  it('targets the GAP group/version', () => {
    expect(APP_PLATFORM_API_VERSION).toBe('pathfinderbackend.ext.grafana.app/v1alpha1');
    expect(collectionUrl('stacks-1')).toBe(
      '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-1/backend/custom-guide'
    );
  });

  it('encodes the resource name to guard against path traversal', () => {
    expect(itemUrl('stacks-1', '../x')).toBe(
      `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-1/backend/custom-guide?${new URLSearchParams({ name: '../x' })}`
    );
  });
});
