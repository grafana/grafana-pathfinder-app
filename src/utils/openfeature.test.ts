/**
 * Tests for OpenFeature module
 *
 * Note: These tests use jest.isolateModules to ensure fresh module state
 * between tests, since the module has internal initialization state.
 */

// Mock @grafana/runtime before importing the module
jest.mock('@grafana/runtime', () => ({
  config: {
    namespace: 'stacks-12345',
  },
}));

// Mock @openfeature/ofrep-web-provider
jest.mock('@openfeature/ofrep-web-provider', () => ({
  OFREPWebProvider: jest.fn().mockImplementation((config) => ({
    name: 'ofrep',
    config,
  })),
}));

// Mock the TrackingHook and the exposure helper
const mockReportFeatureFlagExposure = jest.fn();
jest.mock('./openfeature-tracking', () => ({
  TrackingHook: jest.fn().mockImplementation(() => ({
    after: jest.fn(),
  })),
  reportFeatureFlagExposure: (...args: unknown[]) => mockReportFeatureFlagExposure(...args),
}));

// Mock analytics to prevent actual tracking
jest.mock('../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    FeatureFlagEvaluated: 'feature_flag_evaluated',
  },
}));

// Create mock for OpenFeature (web-sdk)
const createMockOpenFeature = () => {
  const mockClient = {
    getBooleanValue: jest.fn(),
    getStringValue: jest.fn(),
    getNumberValue: jest.fn(),
    getObjectValue: jest.fn(),
    addHooks: jest.fn(),
    providerStatus: 'READY',
    addHandler: jest.fn(),
  };

  const defaultProvider = { name: 'default' };
  const domainProviders: Record<string, any> = {};

  // API-level addHooks mock
  const apiAddHooks = jest.fn();

  return {
    mockClient,
    domainProviders,
    apiAddHooks,
    // Web SDK exports
    OpenFeature: {
      setProviderAndWait: jest.fn((domain: string, provider: any) => {
        domainProviders[domain] = provider;
        return Promise.resolve();
      }),
      setProvider: jest.fn((domain: string, provider: any) => {
        domainProviders[domain] = provider;
      }),
      getProvider: jest.fn((domain?: string) => {
        if (domain && domainProviders[domain]) {
          return domainProviders[domain];
        }
        return defaultProvider;
      }),
      getClient: jest.fn(() => mockClient),
      addHooks: apiAddHooks,
    },
    ClientProviderStatus: {
      NOT_READY: 'NOT_READY',
      READY: 'READY',
      ERROR: 'ERROR',
      STALE: 'STALE',
    },
    ProviderEvents: {
      Ready: 'PROVIDER_READY',
      Error: 'PROVIDER_ERROR',
      ConfigurationChanged: 'PROVIDER_CONFIGURATION_CHANGED',
      Stale: 'PROVIDER_STALE',
    },
  };
};

// Create mock for React SDK hooks
const createMockReactSdk = () => ({
  useBooleanFlagValue: jest.fn(),
  useStringFlagValue: jest.fn(),
  useNumberFlagValue: jest.fn(),
});

describe('openfeature', () => {
  describe('constants', () => {
    it('OPENFEATURE_DOMAIN should be set to grafana-pathfinder-app', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { OPENFEATURE_DOMAIN } = require('./openfeature');
        expect(OPENFEATURE_DOMAIN).toBe('grafana-pathfinder-app');
      });
    });

    it('pathfinderFeatureFlags should have trackingKey for each flag', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { pathfinderFeatureFlags } = require('./openfeature');
        expect(pathfinderFeatureFlags['pathfinder.auto-open-sidebar'].trackingKey).toBe('auto_open_sidebar');
        expect(pathfinderFeatureFlags['pathfinder.highlighted-guide-experiment'].trackingKey).toBe(
          'highlighted_guide_experiment'
        );
        expect(pathfinderFeatureFlags['pathfinder.frontend-telemetry'].trackingKey).toBe('frontend_telemetry');
        expect(pathfinderFeatureFlags['pathfinder.frontend-telemetry-sample-rate'].trackingKey).toBe(
          'frontend_telemetry_sample_rate'
        );
      });
    });

    it('pathfinder.frontend-telemetry should default to true', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { pathfinderFeatureFlags } = require('./openfeature');
        expect(pathfinderFeatureFlags['pathfinder.frontend-telemetry'].defaultValue).toBe(true);
      });
    });

    it('pathfinder.frontend-telemetry-sample-rate should default to 1 (every session)', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { pathfinderFeatureFlags } = require('./openfeature');
        expect(pathfinderFeatureFlags['pathfinder.frontend-telemetry-sample-rate'].defaultValue).toBe(1);
      });
    });
  });

  describe('initializeOpenFeature', () => {
    it('should set provider with correct configuration using setProviderAndWait', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { initializeOpenFeature, OPENFEATURE_DOMAIN } = require('./openfeature');
        await initializeOpenFeature();

        expect(mockOF.OpenFeature.setProviderAndWait).toHaveBeenCalledWith(
          OPENFEATURE_DOMAIN,
          expect.objectContaining({
            name: 'ofrep',
            config: expect.objectContaining({
              baseUrl: '/apis/features.grafana.app/v0alpha1/namespaces/stacks-12345',
              disableVisibilityRefresh: true,
              cacheMode: 'disabled',
              timeoutMs: 10_000,
            }),
          }),
          expect.objectContaining({
            targetingKey: 'stacks-12345',
            namespace: 'stacks-12345',
          })
        );
      });
    });

    it('should add TrackingHook at API level after provider is ready', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { initializeOpenFeature } = require('./openfeature');
        await initializeOpenFeature();

        // TrackingHook should be added at API level (not client level) during initialization
        expect(mockOF.apiAddHooks).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle missing namespace gracefully', async () => {
      await jest.isolateModulesAsync(async () => {
        // Mock config without namespace
        jest.doMock('@grafana/runtime', () => ({
          config: {
            namespace: undefined,
          },
        }));

        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const { initializeOpenFeature } = require('./openfeature');
        await initializeOpenFeature();

        expect(consoleSpy).toHaveBeenCalledWith(
          '[OpenFeature] config.namespace not available, skipping initialization'
        );
        expect(mockOF.OpenFeature.setProviderAndWait).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });
  });

  describe('getFeatureFlagClient', () => {
    it('should return client for the pathfinder domain', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getFeatureFlagClient, OPENFEATURE_DOMAIN } = require('./openfeature');
        getFeatureFlagClient();

        expect(mockOF.OpenFeature.getClient).toHaveBeenCalledWith(OPENFEATURE_DOMAIN);
      });
    });
  });

  describe('getFeatureFlagValue', () => {
    it('should return flag value from client', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getBooleanValue.mockReturnValue(true);
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getFeatureFlagValue } = require('./openfeature');
        const result = getFeatureFlagValue('pathfinder.auto-open-sidebar', false);

        expect(mockOF.mockClient.getBooleanValue).toHaveBeenCalledWith('pathfinder.auto-open-sidebar', false);
        expect(result).toBe(true);
      });
    });

    it('should return default value on error', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getBooleanValue.mockImplementation(() => {
          throw new Error('Provider not ready');
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const { getFeatureFlagValue } = require('./openfeature');
        const result = getFeatureFlagValue('some-flag', true);

        expect(result).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("[OpenFeature] Error evaluating flag 'some-flag'"),
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });
    });
  });

  describe('getStringFlagValue', () => {
    it('should return string flag value from client', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getStringValue.mockReturnValue('b');
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getStringFlagValue } = require('./openfeature');
        const result = getStringFlagValue('pathfinder.string-flag', 'a');

        expect(mockOF.mockClient.getStringValue).toHaveBeenCalledWith('pathfinder.string-flag', 'a');
        expect(result).toBe('b');
      });
    });

    it('should return default value when flag returns default', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getStringValue.mockReturnValue('a');
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getStringFlagValue } = require('./openfeature');
        const result = getStringFlagValue('pathfinder.string-flag', 'a');

        expect(result).toBe('a');
      });
    });

    it('should return default value on error', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getStringValue.mockImplementation(() => {
          throw new Error('Provider not ready');
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const { getStringFlagValue } = require('./openfeature');
        const result = getStringFlagValue('experiment-flag', 'default-variant');

        expect(result).toBe('default-variant');
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("[OpenFeature] Error evaluating flag 'experiment-flag'"),
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });
    });
  });

  describe('getNumberFlagValue', () => {
    it('should return number flag value from client', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getNumberValue.mockReturnValue(0.25);
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getNumberFlagValue } = require('./openfeature');
        const result = getNumberFlagValue('pathfinder.frontend-telemetry-sample-rate', 1);

        expect(mockOF.mockClient.getNumberValue).toHaveBeenCalledWith('pathfinder.frontend-telemetry-sample-rate', 1);
        expect(result).toBe(0.25);
      });
    });

    it('should return default value on error', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getNumberValue.mockImplementation(() => {
          throw new Error('Provider not ready');
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const { getNumberFlagValue } = require('./openfeature');
        const result = getNumberFlagValue('pathfinder.frontend-telemetry-sample-rate', 1);

        expect(result).toBe(1);
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("[OpenFeature] Error evaluating flag 'pathfinder.frontend-telemetry-sample-rate'"),
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });
    });
  });

  describe('getActiveExperiments', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('returns only the enrolled experiment, dropping excluded arms', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockImplementation((flagName: string) => {
          if (flagName === 'pathfinder.highlighted-guide-experiment') {
            return {
              variant: 'treatment',
              pages: ['/a/grafana-irm-app*'],
              guideId: 'https://interactive-learning.grafana.net/packages/grafana-irm-configuration-lj/content.json',
              autoOpen: true,
              docType: 'learning-journey',
            };
          }
          return { variant: 'excluded', pages: [] };
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getActiveExperiments } = require('./openfeature');
        const result = getActiveExperiments();

        expect(result).toEqual([
          {
            flag: 'pathfinder.highlighted-guide-experiment',
            variant: 'treatment',
            pages: ['/a/grafana-irm-app*'],
            guideId: 'https://interactive-learning.grafana.net/packages/grafana-irm-configuration-lj/content.json',
            autoOpen: true,
            docType: 'learning-journey',
            resetCache: false,
          },
        ]);
      });
    });

    it('returns an empty array when no experiment is enrolled', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({ variant: 'excluded', pages: [] });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getActiveExperiments } = require('./openfeature');
        expect(getActiveExperiments()).toEqual([]);
      });
    });

    it('reflects a localStorage override for the highlighted-guide flag (incl. guideId/docType)', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({ variant: 'excluded', pages: [] });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const { setFlagOverride, getActiveExperiments } = require('./openfeature');
        setFlagOverride('pathfinder.highlighted-guide-experiment', {
          variant: 'treatment',
          pages: ['/a/grafana-irm-app*'],
          guideId: 'bundled:my-guide',
          autoOpen: true,
          docType: 'interactive',
        });

        const highlighted = getActiveExperiments().find(
          (entry: { flag: string }) => entry.flag === 'pathfinder.highlighted-guide-experiment'
        );

        expect(highlighted).toEqual(
          expect.objectContaining({ variant: 'treatment', guideId: 'bundled:my-guide', docType: 'interactive' })
        );

        consoleSpy.mockRestore();
      });
    });
  });

  describe('evaluateFeatureFlag', () => {
    it('should evaluate boolean flag (tracking happens via hook added at init)', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getBooleanValue.mockReturnValue(true);
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { evaluateFeatureFlag } = require('./openfeature');
        const result = await evaluateFeatureFlag('pathfinder.auto-open-sidebar');

        // TrackingHook is added during initializeOpenFeature, not during evaluate
        expect(mockOF.mockClient.getBooleanValue).toHaveBeenCalledWith('pathfinder.auto-open-sidebar', false);
        expect(result).toBe(true);
      });
    });

    it('should evaluate object flag', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        const expectedConfig = { variant: 'treatment', pages: ['/test'] };
        mockOF.mockClient.getObjectValue.mockReturnValue(expectedConfig);
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { evaluateFeatureFlag, DEFAULT_HIGHLIGHTED_GUIDE_CONFIG } = require('./openfeature');
        const result = await evaluateFeatureFlag('pathfinder.highlighted-guide-experiment');

        expect(mockOF.mockClient.getObjectValue).toHaveBeenCalledWith(
          'pathfinder.highlighted-guide-experiment',
          DEFAULT_HIGHLIGHTED_GUIDE_CONFIG
        );
        expect(result).toEqual(expectedConfig);
      });
    });

    it('should return default value on error', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getBooleanValue.mockImplementation(() => {
          throw new Error('Evaluation failed');
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const { evaluateFeatureFlag } = require('./openfeature');
        const result = await evaluateFeatureFlag('pathfinder.auto-open-sidebar');

        expect(result).toBe(false); // Default value for auto-open-sidebar
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });
  });

  describe('flag overrides', () => {
    beforeEach(() => {
      localStorage.clear();
      mockReportFeatureFlagExposure.mockClear();
    });

    it('getFlagOverrides should return empty object when no overrides set', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getFlagOverrides } = require('./openfeature');
        expect(getFlagOverrides()).toEqual({});
      });
    });

    it('setFlagOverride should persist to localStorage', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { setFlagOverride, getFlagOverrides } = require('./openfeature');
        setFlagOverride('pathfinder.auto-open-sidebar', true);

        expect(getFlagOverrides()).toEqual({ 'pathfinder.auto-open-sidebar': true });
      });
    });

    it('removeFlagOverride should remove a single override', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { setFlagOverride, removeFlagOverride, getFlagOverrides } = require('./openfeature');
        setFlagOverride('pathfinder.auto-open-sidebar', true);
        setFlagOverride('pathfinder.highlighted-guide-experiment', { variant: 'control', pages: [] });

        removeFlagOverride('pathfinder.auto-open-sidebar');

        const overrides = getFlagOverrides();
        expect('pathfinder.auto-open-sidebar' in overrides).toBe(false);
        expect('pathfinder.highlighted-guide-experiment' in overrides).toBe(true);
      });
    });

    it('clearFlagOverrides should remove all overrides', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { setFlagOverride, clearFlagOverrides, getFlagOverrides } = require('./openfeature');
        setFlagOverride('pathfinder.auto-open-sidebar', true);
        setFlagOverride('pathfinder.highlighted-guide-experiment', { variant: 'control', pages: [] });

        clearFlagOverrides();

        expect(getFlagOverrides()).toEqual({});
      });
    });

    it('getFeatureFlagValue should use override when set', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getBooleanValue.mockReturnValue(false);
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const { setFlagOverride, getFeatureFlagValue } = require('./openfeature');
        setFlagOverride('pathfinder.auto-open-sidebar', true);

        const result = getFeatureFlagValue('pathfinder.auto-open-sidebar', false);

        expect(result).toBe(true);
        expect(mockOF.mockClient.getBooleanValue).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
      });
    });

    it('getFeatureFlagValue should ignore non-boolean overrides', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getBooleanValue.mockReturnValue(false);
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { setFlagOverride, getFeatureFlagValue } = require('./openfeature');
        setFlagOverride('pathfinder.auto-open-sidebar', 'not-a-boolean');

        const result = getFeatureFlagValue('pathfinder.auto-open-sidebar', false);

        expect(result).toBe(false);
        expect(mockOF.mockClient.getBooleanValue).toHaveBeenCalled();
      });
    });

    it('getHighlightedGuideConfig should fire exposure event when returning via override', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const { setFlagOverride, getHighlightedGuideConfig } = require('./openfeature');
        setFlagOverride('pathfinder.highlighted-guide-experiment', {
          variant: 'treatment',
          pages: ['/a/grafana-irm-app*'],
          guideId: 'bundled:my-guide',
          autoOpen: true,
        });

        getHighlightedGuideConfig();

        expect(mockReportFeatureFlagExposure).toHaveBeenCalledTimes(1);
        expect(mockReportFeatureFlagExposure).toHaveBeenCalledWith(
          'pathfinder.highlighted-guide-experiment',
          expect.objectContaining({
            variant: 'treatment',
            pages: ['/a/grafana-irm-app*'],
            guideId: 'bundled:my-guide',
            autoOpen: true,
          })
        );
        expect(mockOF.mockClient.getObjectValue).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });

    it('getHighlightedGuideConfig should NOT fire exposure when override is invalid and falls through', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'excluded',
          pages: [],
          guideId: '',
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { setFlagOverride, getHighlightedGuideConfig } = require('./openfeature');
        // Missing `guideId` — invalid override per validateHighlightedGuideValue.
        setFlagOverride('pathfinder.highlighted-guide-experiment', { variant: 'treatment', pages: [] });

        getHighlightedGuideConfig();

        expect(mockReportFeatureFlagExposure).not.toHaveBeenCalled();
        expect(mockOF.mockClient.getObjectValue).toHaveBeenCalled();
      });
    });
  });

  describe('matchPathPattern', () => {
    it('should match exact paths', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { matchPathPattern } = require('./openfeature');
        expect(matchPathPattern('/a/app/schedules', '/a/app/schedules')).toBe(true);
        expect(matchPathPattern('/a/app/schedules', '/a/app/schedules/')).toBe(true);
        expect(matchPathPattern('/a/app/schedules', '/a/app/schedules/123')).toBe(false);
      });
    });

    it('should match wildcard paths', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { matchPathPattern } = require('./openfeature');
        expect(matchPathPattern('/a/app/schedules*', '/a/app/schedules')).toBe(true);
        expect(matchPathPattern('/a/app/schedules*', '/a/app/schedules/123')).toBe(true);
        expect(matchPathPattern('/a/app/schedules*', '/a/app/schedule')).toBe(false);
        expect(matchPathPattern('/a/app/schedules*', '/a/app/schedules-v2')).toBe(false);
        expect(matchPathPattern('/a/grafana-irm-app*', '/a/grafana-irm-appointments')).toBe(false);
      });
    });
  });
});
