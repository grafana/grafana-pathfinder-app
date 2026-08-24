/**
 * Tests for the PathfinderSettings App Platform client.
 *
 * The point of this store is that it cannot collide with plugin `jsonData`, so
 * the invariants worth pinning are about what crosses the boundary: only
 * tenant-owned fields go out, provisioned and per-user fields never do, and an
 * unavailable API degrades to null rather than throwing.
 */

import { config } from '@grafana/runtime';

import { TENANT_SETTING_KEYS } from '../constants';
import { configToSpec, specToConfig, isSettingsApiAvailable } from './pathfinder-settings-api';

jest.mock('./interactive-guides-api', () => ({
  APP_PLATFORM_API_VERSION: 'pathfinderbackend.ext.grafana.app/v1alpha1',
  isBackendApiAvailable: jest.fn(() => true),
}));

const { isBackendApiAvailable } = require('./interactive-guides-api');
const mockAvailable = isBackendApiAvailable as jest.MockedFunction<() => boolean>;

describe('configToSpec', () => {
  it('emits every tenant-owned key it is given', () => {
    const spec = configToSpec({
      recommenderServiceUrl: 'https://recommender.grafana.com',
      enableLiveSessions: true,
      guidedStepTimeout: 2000,
    });

    expect(spec).toEqual({
      recommenderServiceUrl: 'https://recommender.grafana.com',
      enableLiveSessions: true,
      guidedStepTimeout: 2000,
    });
  });

  it('never writes the provisioned stackId into the resource', () => {
    // The #1514 failure mode, made structurally impossible: `stackId` belongs to
    // stack-state-service and must not appear in a document this plugin writes.
    const spec = configToSpec({ stackId: 'stack-123', enableLiveSessions: true });

    expect(spec).not.toHaveProperty('stackId');
    expect(spec).toEqual({ enableLiveSessions: true });
  });

  it('never writes per-user state into the tenant resource', () => {
    const spec = configToSpec({ devModeOptIn: true, devMode: true });

    expect(spec).not.toHaveProperty('devModeOptIn');
    expect(spec).toEqual({ devModeEnabled: true });
  });

  it('never writes the deprecated devModeUserIds allow-list', () => {
    const spec = configToSpec({ devModeUserIds: [7, 8], devMode: true });

    expect(spec).not.toHaveProperty('devModeUserIds');
    expect(spec).toEqual({ devModeEnabled: true });
  });

  it('omits absent fields rather than writing undefined over them', () => {
    const spec = configToSpec({ enableLiveSessions: undefined, guidedStepTimeout: 2000 });

    expect(Object.keys(spec)).toEqual(['guidedStepTimeout']);
  });

  it('round-trips every tenant-owned key through specToConfig', () => {
    // Guards the devMode/devModeEnabled rename in both directions: a key that
    // survives one leg but not the other would silently stop persisting.
    const full = Object.fromEntries(TENANT_SETTING_KEYS.map((key) => [key, key === 'devMode' ? true : `v-${key}`]));

    const roundTripped = specToConfig(configToSpec(full));

    expect(roundTripped).toEqual(full);
  });
});

describe('specToConfig', () => {
  it('maps the stored devModeEnabled onto the client-side devMode gate', () => {
    expect(specToConfig({ devModeEnabled: true })).toEqual({ devMode: true });
  });

  it('drops schemaVersion, which is storage bookkeeping rather than config', () => {
    expect(specToConfig({ schemaVersion: 1, enableLiveSessions: true })).toEqual({ enableLiveSessions: true });
  });

  it('leaves devMode absent when the spec does not carry the gate', () => {
    expect(specToConfig({ enableLiveSessions: true })).toEqual({ enableLiveSessions: true });
  });
});

describe('isSettingsApiAvailable', () => {
  const originalNamespace = config.namespace;

  afterEach(() => {
    config.namespace = originalNamespace;
    mockAvailable.mockReturnValue(true);
  });

  it('is available with both the aggregation toggle and a namespace', () => {
    mockAvailable.mockReturnValue(true);
    config.namespace = 'stacks-123';

    expect(isSettingsApiAvailable()).toBe(true);
  });

  it('is unavailable without the aggregation toggle', () => {
    mockAvailable.mockReturnValue(false);
    config.namespace = 'stacks-123';

    expect(isSettingsApiAvailable()).toBe(false);
  });

  it('is unavailable without a namespace', () => {
    // Some self-managed builds serve no namespace; the caller must fall back to
    // jsonData rather than issuing a request to /namespaces//.
    mockAvailable.mockReturnValue(true);
    config.namespace = '';

    expect(isSettingsApiAvailable()).toBe(false);
  });
});
