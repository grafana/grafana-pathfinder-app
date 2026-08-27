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
        expect(pathfinderFeatureFlags['pathfinder.session-replay'].trackingKey).toBe('session_replay');
        expect(pathfinderFeatureFlags['pathfinder.session-replay-sampling-rate'].trackingKey).toBe(
          'session_replay_sampling_rate'
        );
        expect(pathfinderFeatureFlags['pathfinder.interactive-learning-banner-experiment'].trackingKey).toBe(
          'interactive_learning_banner_experiment'
        );
      });
    });

    it('pathfinder.interactive-learning-banner-experiment must be object-valued to emit exposures', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { pathfinderFeatureFlags } = require('./openfeature');
        // reportFeatureFlagExposure drops non-object flags, so a boolean here would
        // silently mean the experiment never records an enrollment.
        expect(pathfinderFeatureFlags['pathfinder.interactive-learning-banner-experiment'].valueType).toBe('object');
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

    it('pathfinder.session-replay should default to true', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { pathfinderFeatureFlags } = require('./openfeature');
        expect(pathfinderFeatureFlags['pathfinder.session-replay'].defaultValue).toBe(true);
      });
    });

    it('pathfinder.session-replay-sampling-rate should default to 1', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { pathfinderFeatureFlags } = require('./openfeature');
        const flag = pathfinderFeatureFlags['pathfinder.session-replay-sampling-rate'];
        expect(flag.valueType).toBe('number');
        expect(flag.defaultValue).toBe(1);
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
          '[OpenFeature] config.namespace not available, skipping initialization',
          ''
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
          expect.any(Error),
          ''
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
          expect.any(Error),
          ''
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

    it('getHighlightedGuideConfig should not take the override short-circuit when the variant is unrecognized', () => {
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
        setFlagOverride('pathfinder.highlighted-guide-experiment', {
          variant: 'treament',
          pages: ['/a/grafana-irm-app*'],
          guideId: 'bundled:my-guide',
        });

        getHighlightedGuideConfig();

        expect(mockReportFeatureFlagExposure).not.toHaveBeenCalled();
        expect(mockOF.mockClient.getObjectValue).toHaveBeenCalled();
      });
    });

    it('getHighlightedGuideConfig should return the remote value when the override is rejected', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        const remoteConfig = {
          variant: 'treatment',
          pages: ['/a/grafana-irm-app*'],
          guideId: 'bundled:remote-guide',
          autoOpen: true,
          resetCache: false,
        };
        mockOF.mockClient.getObjectValue.mockReturnValue(remoteConfig);
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { setFlagOverride, getHighlightedGuideConfig } = require('./openfeature');
        setFlagOverride('pathfinder.highlighted-guide-experiment', {
          variant: 'treament',
          pages: ['/a/grafana-irm-app*'],
          guideId: 'bundled:my-override-guide',
        });

        // A rejected override is ignored in favor of the remote MTFF value — it
        // does NOT fall back to DEFAULT_HIGHLIGHTED_GUIDE_CONFIG.
        expect(getHighlightedGuideConfig()).toEqual(remoteConfig);
      });
    });

    it('getHighlightedGuideConfig should warn once per page load when the override is rejected', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({ variant: 'excluded', pages: [], guideId: '' });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const { setFlagOverride, getHighlightedGuideConfig } = require('./openfeature');
        setFlagOverride('pathfinder.highlighted-guide-experiment', {
          variant: 'treament',
          pages: [],
          guideId: 'bundled:my-guide',
        });

        getHighlightedGuideConfig();
        getHighlightedGuideConfig();
        getHighlightedGuideConfig();

        const rejectionWarns = consoleSpy.mock.calls.filter((call) =>
          String(call[0]).includes("Rejected the override payload for 'pathfinder.highlighted-guide-experiment'")
        );
        expect(rejectionWarns).toHaveLength(1);
        expect(rejectionWarns[0]?.[1]).toEqual({ reason: 'unknown_variant' });

        consoleSpy.mockRestore();
      });
    });

    it('getHighlightedGuideConfig should fall through when pages contain only non-string elements', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        const remoteConfig = {
          variant: 'control',
          pages: ['/connections/datasources*'],
          guideId: 'bundled:remote-guide',
        };
        mockOF.mockClient.getObjectValue.mockReturnValue(remoteConfig);
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { setFlagOverride, getHighlightedGuideConfig } = require('./openfeature');
        setFlagOverride('pathfinder.highlighted-guide-experiment', {
          variant: 'treatment',
          pages: [1, 2],
          guideId: 'bundled:my-guide',
        });

        expect(getHighlightedGuideConfig()).toEqual({
          ...remoteConfig,
          autoOpen: true,
          resetCache: false,
        });
        expect(mockReportFeatureFlagExposure).not.toHaveBeenCalled();
        expect(mockOF.mockClient.getObjectValue).toHaveBeenCalled();
      });
    });

    it('getHighlightedGuideConfig should fall through when pages mix valid and non-string elements', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        const remoteConfig = {
          variant: 'control',
          pages: ['/connections/datasources*'],
          guideId: 'bundled:remote-guide',
        };
        mockOF.mockClient.getObjectValue.mockReturnValue(remoteConfig);
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { setFlagOverride, getHighlightedGuideConfig } = require('./openfeature');
        setFlagOverride('pathfinder.highlighted-guide-experiment', {
          variant: 'treatment',
          pages: ['/explore', 1],
          guideId: 'bundled:my-guide',
        });

        expect(getHighlightedGuideConfig()).toEqual({
          ...remoteConfig,
          autoOpen: true,
          resetCache: false,
        });
        expect(mockReportFeatureFlagExposure).not.toHaveBeenCalled();
        expect(mockOF.mockClient.getObjectValue).toHaveBeenCalled();
      });
    });

    it('getHighlightedGuideConfig should accept pages with all string elements', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { setFlagOverride, getHighlightedGuideConfig } = require('./openfeature');
        setFlagOverride('pathfinder.highlighted-guide-experiment', {
          variant: 'treatment',
          pages: ['/explore', '/other'],
          guideId: 'bundled:my-guide',
        });

        expect(getHighlightedGuideConfig()).toEqual({
          variant: 'treatment',
          pages: ['/explore', '/other'],
          guideId: 'bundled:my-guide',
          autoOpen: true,
          resetCache: false,
        });
        expect(mockOF.mockClient.getObjectValue).not.toHaveBeenCalled();
      });
    });
  });

  describe('highlighted-guide variant validation', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it.each(['treament', 'TREATMENT', 'holdback', ''])(
      'falls back to the default config when the remote variant is %p',
      (variant) => {
        jest.isolateModules(() => {
          const mockOF = createMockOpenFeature();
          const mockReact = createMockReactSdk();
          mockOF.mockClient.getObjectValue.mockReturnValue({
            variant,
            pages: ['/a/grafana-irm-app*'],
            guideId: 'bundled:my-guide',
            autoOpen: true,
          });
          jest.doMock('@openfeature/web-sdk', () => mockOF);
          jest.doMock('@openfeature/react-sdk', () => mockReact);

          const { getHighlightedGuideConfig, DEFAULT_HIGHLIGHTED_GUIDE_CONFIG } = require('./openfeature');
          const { getActiveExperiments } = require('./experiments/active-experiments');

          expect(getHighlightedGuideConfig()).toEqual(DEFAULT_HIGHLIGHTED_GUIDE_CONFIG);
          expect(getActiveExperiments()).toEqual([]);
        });
      }
    );

    it('discards resetCache along with the rest of a rejected payload', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treament',
          pages: ['/a/grafana-irm-app*'],
          guideId: 'bundled:my-guide',
          resetCache: true,
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getHighlightedGuideConfig } = require('./openfeature');

        // Rejection is whole-payload: handleHighlightedGuideResetCache reads
        // resetCache before any variant check, so it must not survive.
        expect(getHighlightedGuideConfig().resetCache).toBe(false);
      });
    });

    it.each([
      [{ variant: 'treament', pages: [], guideId: '' }, 'unknown_variant'],
      [{ variant: 'treatment', pages: [] }, 'invalid_shape'],
    ])('warns once per page load for a rejected remote payload (%#)', (remoteValue, reason) => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue(remoteValue);
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const { getHighlightedGuideConfig } = require('./openfeature');

        getHighlightedGuideConfig();
        getHighlightedGuideConfig();
        getHighlightedGuideConfig();

        const rejectionWarns = consoleSpy.mock.calls.filter((call) =>
          String(call[0]).includes("Rejected the remote payload for 'pathfinder.highlighted-guide-experiment'")
        );
        expect(rejectionWarns).toHaveLength(1);
        expect(rejectionWarns[0]?.[1]).toEqual({ reason });

        consoleSpy.mockRestore();
      });
    });

    it('does not warn for a valid remote payload', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treatment',
          pages: ['/a/grafana-irm-app*'],
          guideId: 'bundled:my-guide',
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const { getHighlightedGuideConfig } = require('./openfeature');
        getHighlightedGuideConfig();

        expect(consoleSpy.mock.calls.filter((call) => String(call[0]).includes('Rejected the'))).toHaveLength(0);

        consoleSpy.mockRestore();
      });
    });

    it.each(['excluded', 'control', 'treatment'])('passes the %p variant through unchanged', (variant) => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant,
          pages: ['/a/grafana-irm-app*'],
          guideId: 'bundled:my-guide',
          autoOpen: true,
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getHighlightedGuideConfig } = require('./openfeature');

        expect(getHighlightedGuideConfig()).toEqual({
          variant,
          pages: ['/a/grafana-irm-app*'],
          guideId: 'bundled:my-guide',
          autoOpen: true,
          resetCache: false,
        });
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
