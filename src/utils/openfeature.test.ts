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

// Mock the TrackingHook
jest.mock('./openfeature-tracking', () => ({
  TrackingHook: jest.fn().mockImplementation(() => ({
    after: jest.fn(),
  })),
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

  return {
    mockClient,
    domainProviders,
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

    it('FeatureFlags should define AUTO_OPEN_SIDEBAR_ON_LAUNCH', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { FeatureFlags } = require('./openfeature');
        expect(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH).toBe('pathfinder.auto-open-sidebar');
      });
    });

    it('FeatureFlags should define EXPERIMENT_VARIANT', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { FeatureFlags } = require('./openfeature');
        expect(FeatureFlags.EXPERIMENT_VARIANT).toBe('pathfinder.experiment-variant');
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
        expect(pathfinderFeatureFlags['pathfinder.experiment-variant'].trackingKey).toBe('experiment_variant');
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
              pollInterval: -1,
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

    it('should add TrackingHook to client after provider is ready', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { initializeOpenFeature } = require('./openfeature');
        await initializeOpenFeature();

        // TrackingHook should be added once during initialization
        expect(mockOF.mockClient.addHooks).toHaveBeenCalledTimes(1);
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

        const { getFeatureFlagValue, FeatureFlags } = require('./openfeature');
        const result = getFeatureFlagValue(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH, false);

        expect(mockOF.mockClient.getBooleanValue).toHaveBeenCalledWith(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH, false);
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

        const { getStringFlagValue, FeatureFlags } = require('./openfeature');
        const result = getStringFlagValue(FeatureFlags.EXPERIMENT_VARIANT, 'a');

        expect(mockOF.mockClient.getStringValue).toHaveBeenCalledWith(FeatureFlags.EXPERIMENT_VARIANT, 'a');
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

        const { getStringFlagValue, FeatureFlags } = require('./openfeature');
        const result = getStringFlagValue(FeatureFlags.EXPERIMENT_VARIANT, 'a');

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

  describe('getExperimentConfig', () => {
    it('should return treatment config with pages from GOFF', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treatment',
          pages: ['/a/grafana-synthetic-monitoring-app/checks/create'],
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getExperimentConfig, FeatureFlags } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual({
          variant: 'treatment',
          pages: ['/a/grafana-synthetic-monitoring-app/checks/create'],
          resetCache: false,
        });
      });
    });

    it('should return control config with empty pages', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'control',
          pages: [],
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getExperimentConfig, FeatureFlags } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual({
          variant: 'control',
          pages: [],
          resetCache: false,
        });
      });
    });

    it('should return excluded config (default) when not in experiment', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'excluded',
          pages: [],
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getExperimentConfig, FeatureFlags } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual({
          variant: 'excluded',
          pages: [],
          resetCache: false,
        });
      });
    });

    it('should return resetCache: true when set in GOFF config', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treatment',
          pages: ['/a/grafana-synthetic-monitoring-app/'],
          resetCache: true,
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getExperimentConfig, FeatureFlags } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual({
          variant: 'treatment',
          pages: ['/a/grafana-synthetic-monitoring-app/'],
          resetCache: true,
        });
      });
    });

    it('should return DEFAULT_EXPERIMENT_CONFIG when response is invalid (missing pages)', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        // Return invalid response (missing pages)
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treatment',
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getExperimentConfig, FeatureFlags, DEFAULT_EXPERIMENT_CONFIG } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual(DEFAULT_EXPERIMENT_CONFIG);
      });
    });

    it('should return DEFAULT_EXPERIMENT_CONFIG when response is invalid (pages not array)', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treatment',
          pages: 'not-an-array',
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getExperimentConfig, FeatureFlags, DEFAULT_EXPERIMENT_CONFIG } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual(DEFAULT_EXPERIMENT_CONFIG);
      });
    });

    it('should return DEFAULT_EXPERIMENT_CONFIG on error', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockImplementation(() => {
          throw new Error('Provider not ready');
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const { getExperimentConfig, FeatureFlags, DEFAULT_EXPERIMENT_CONFIG } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual(DEFAULT_EXPERIMENT_CONFIG);
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[OpenFeature] Error evaluating flag'),
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });
    });

    it('should handle multiple target pages for IRM treatment', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        const mockReact = createMockReactSdk();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treatment',
          pages: ['/a/grafana-synthetic-monitoring-app/', '/a/grafana-irm-app/'],
        });
        jest.doMock('@openfeature/web-sdk', () => mockOF);
        jest.doMock('@openfeature/react-sdk', () => mockReact);

        const { getExperimentConfig, FeatureFlags } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result.variant).toBe('treatment');
        expect(result.pages).toHaveLength(2);
        expect(result.pages).toContain('/a/grafana-synthetic-monitoring-app/');
        expect(result.pages).toContain('/a/grafana-irm-app/');
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

        const { evaluateFeatureFlag, DEFAULT_EXPERIMENT_CONFIG } = require('./openfeature');
        const result = await evaluateFeatureFlag('pathfinder.experiment-variant');

        expect(mockOF.mockClient.getObjectValue).toHaveBeenCalledWith(
          'pathfinder.experiment-variant',
          DEFAULT_EXPERIMENT_CONFIG
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
      });
    });
  });
});
