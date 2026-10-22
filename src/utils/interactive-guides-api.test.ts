let mockToggles: Record<string, boolean> = {};

jest.mock('@grafana/runtime', () => ({
  config: {
    get featureToggles() {
      return mockToggles;
    },
  },
}));

import {
  APP_PLATFORM_API_VERSION,
  collectionUrl,
  isBackendApiAvailable,
  isBackendApiRuledOut,
  itemUrl,
} from './interactive-guides-api';

const GAP_TOGGLE = 'aggregation.pathfinderbackend-ext-grafana-app.enabled';

beforeEach(() => {
  mockToggles = {};
});

describe('isBackendApiAvailable', () => {
  it('is true only when the GAP aggregation toggle is on', () => {
    mockToggles = { [GAP_TOGGLE]: true };
    expect(isBackendApiAvailable()).toBe(true);
  });

  it('is false when the toggle is absent from populated boot toggles', () => {
    mockToggles = { someOtherToggle: true };
    expect(isBackendApiAvailable()).toBe(false);
  });

  it('is false when the boot toggles are empty, so direct reads and writes stay off', () => {
    expect(isBackendApiAvailable()).toBe(false);
  });

  it('does not treat the legacy CAP toggle as availability', () => {
    mockToggles = { 'aggregation.pathfinderbackend-ext-grafana-com.enabled': true };
    expect(isBackendApiAvailable()).toBe(false);
  });
});

describe('isBackendApiRuledOut', () => {
  it('is true when populated boot toggles lack the GAP toggle', () => {
    mockToggles = { 'aggregation.pathfinderbackend-ext-grafana-com.enabled': true };
    expect(isBackendApiRuledOut()).toBe(true);
  });

  it('is false when the GAP toggle is on', () => {
    mockToggles = { [GAP_TOGGLE]: true };
    expect(isBackendApiRuledOut()).toBe(false);
  });

  it('is false when the boot toggles are empty, as under multi-tenancy', () => {
    expect(isBackendApiRuledOut()).toBe(false);
  });
});

describe('url builders', () => {
  it('targets the GAP group/version', () => {
    expect(APP_PLATFORM_API_VERSION).toBe('pathfinderbackend.ext.grafana.app/v1alpha1');
    expect(collectionUrl('stacks-1')).toBe(
      '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-1/interactiveguides'
    );
  });

  it('encodes the resource name to guard against path traversal', () => {
    expect(itemUrl('stacks-1', '../x')).toBe(
      `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-1/interactiveguides/${encodeURIComponent('../x')}`
    );
  });
});
