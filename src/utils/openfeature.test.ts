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

// Create mock for OpenFeature
const createMockOpenFeature = () => {
  const mockClient = {
    getBooleanValue: jest.fn(),
    getStringValue: jest.fn(),
    getNumberValue: jest.fn(),
    getObjectValue: jest.fn(),
  };

  const defaultProvider = { name: 'default' };
  const domainProviders: Record<string, any> = {};

  return {
    mockClient,
    domainProviders,
    OpenFeature: {
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
    useBooleanFlagValue: jest.fn(),
    useStringFlagValue: jest.fn(),
    useNumberFlagValue: jest.fn(),
  };
};

describe('openfeature', () => {
  describe('constants', () => {
    it('OPENFEATURE_DOMAIN should be set to grafana-pathfinder-app', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { OPENFEATURE_DOMAIN } = require('./openfeature');
        expect(OPENFEATURE_DOMAIN).toBe('grafana-pathfinder-app');
      });
    });

    it('FeatureFlags should define AUTO_OPEN_SIDEBAR_ON_LAUNCH', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { FeatureFlags } = require('./openfeature');
        expect(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH).toBe('pathfinder.auto-open-sidebar');
      });
    });

    it('FeatureFlags should define EXPERIMENT_VARIANT', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { FeatureFlags } = require('./openfeature');
        expect(FeatureFlags.EXPERIMENT_VARIANT).toBe('pathfinder.experiment-variant');
      });
    });
  });

  describe('initializeOpenFeature', () => {
    it('should set provider with correct configuration', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { initializeOpenFeature, OPENFEATURE_DOMAIN } = require('./openfeature');
        initializeOpenFeature();

        expect(mockOF.OpenFeature.setProvider).toHaveBeenCalledWith(
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

    it('should not initialize twice when called multiple times', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { initializeOpenFeature } = require('./openfeature');

        // First call initializes
        initializeOpenFeature();
        expect(mockOF.OpenFeature.setProvider).toHaveBeenCalledTimes(1);

        // Second call should be skipped (isInitialized flag)
        initializeOpenFeature();
        expect(mockOF.OpenFeature.setProvider).toHaveBeenCalledTimes(1);
      });
    });

    it('should not initialize when provider already set for domain', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        // Simulate provider already set by returning different provider for domain
        mockOF.OpenFeature.getProvider = jest.fn((domain?: string) => {
          if (domain === 'grafana-pathfinder-app') {
            return { name: 'already-set' };
          }
          return { name: 'default' };
        });
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { initializeOpenFeature } = require('./openfeature');
        initializeOpenFeature();

        expect(mockOF.OpenFeature.setProvider).not.toHaveBeenCalled();
      });
    });

    it('should handle missing namespace gracefully', () => {
      jest.isolateModules(() => {
        // Mock config without namespace
        jest.doMock('@grafana/runtime', () => ({
          config: {
            namespace: undefined,
          },
        }));

        const mockOF = createMockOpenFeature();
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const { initializeOpenFeature } = require('./openfeature');
        initializeOpenFeature();

        expect(consoleSpy).toHaveBeenCalledWith(
          '[pathfinder]',
          '[OpenFeature] config.namespace not available, skipping initialization'
        );
        expect(mockOF.OpenFeature.setProvider).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });
  });

  describe('getFeatureFlagClient', () => {
    it('should return client for the pathfinder domain', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        jest.doMock('@openfeature/react-sdk', () => mockOF);

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
        mockOF.mockClient.getBooleanValue.mockReturnValue(true);
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { getFeatureFlagValue, FeatureFlags } = require('./openfeature');
        const result = getFeatureFlagValue(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH, false);

        expect(mockOF.mockClient.getBooleanValue).toHaveBeenCalledWith(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH, false);
        expect(result).toBe(true);
      });
    });

    it('should return default value on error', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        mockOF.mockClient.getBooleanValue.mockImplementation(() => {
          throw new Error('Provider not ready');
        });
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const { getFeatureFlagValue } = require('./openfeature');
        const result = getFeatureFlagValue('some-flag', true);

        expect(result).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
          '[pathfinder]',
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
        mockOF.mockClient.getStringValue.mockReturnValue('b');
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { getStringFlagValue, FeatureFlags } = require('./openfeature');
        const result = getStringFlagValue(FeatureFlags.EXPERIMENT_VARIANT, 'a');

        expect(mockOF.mockClient.getStringValue).toHaveBeenCalledWith(FeatureFlags.EXPERIMENT_VARIANT, 'a');
        expect(result).toBe('b');
      });
    });

    it('should return default value when flag returns default', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        mockOF.mockClient.getStringValue.mockReturnValue('a');
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { getStringFlagValue, FeatureFlags } = require('./openfeature');
        const result = getStringFlagValue(FeatureFlags.EXPERIMENT_VARIANT, 'a');

        expect(result).toBe('a');
      });
    });

    it('should return default value on error', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        mockOF.mockClient.getStringValue.mockImplementation(() => {
          throw new Error('Provider not ready');
        });
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const { getStringFlagValue } = require('./openfeature');
        const result = getStringFlagValue('experiment-flag', 'default-variant');

        expect(result).toBe('default-variant');
        expect(consoleSpy).toHaveBeenCalledWith(
          '[pathfinder]',
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
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treatment',
          pages: ['/a/grafana-synthetic-monitoring-app/checks/create'],
        });
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { getExperimentConfig, FeatureFlags } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual({
          variant: 'treatment',
          pages: ['/a/grafana-synthetic-monitoring-app/checks/create'],
        });
      });
    });

    it('should return control config with empty pages', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'control',
          pages: [],
        });
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { getExperimentConfig, FeatureFlags } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual({
          variant: 'control',
          pages: [],
        });
      });
    });

    it('should return excluded config (default) when not in experiment', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'excluded',
          pages: [],
        });
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { getExperimentConfig, FeatureFlags } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual({
          variant: 'excluded',
          pages: [],
        });
      });
    });

    it('should return DEFAULT_EXPERIMENT_CONFIG when response is invalid (missing pages)', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        // Return invalid response (missing pages)
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treatment',
        });
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { getExperimentConfig, FeatureFlags, DEFAULT_EXPERIMENT_CONFIG } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual(DEFAULT_EXPERIMENT_CONFIG);
      });
    });

    it('should return DEFAULT_EXPERIMENT_CONFIG when response is invalid (pages not array)', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treatment',
          pages: 'not-an-array',
        });
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { getExperimentConfig, FeatureFlags, DEFAULT_EXPERIMENT_CONFIG } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual(DEFAULT_EXPERIMENT_CONFIG);
      });
    });

    it('should return DEFAULT_EXPERIMENT_CONFIG on error', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        mockOF.mockClient.getObjectValue.mockImplementation(() => {
          throw new Error('Provider not ready');
        });
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const { getExperimentConfig, FeatureFlags, DEFAULT_EXPERIMENT_CONFIG } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result).toEqual(DEFAULT_EXPERIMENT_CONFIG);
        expect(consoleSpy).toHaveBeenCalledWith(
          '[pathfinder]',
          expect.stringContaining('[OpenFeature] Error evaluating flag'),
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });
    });

    it('should handle multiple target pages for IRM treatment', () => {
      jest.isolateModules(() => {
        const mockOF = createMockOpenFeature();
        mockOF.mockClient.getObjectValue.mockReturnValue({
          variant: 'treatment',
          pages: ['/a/grafana-synthetic-monitoring-app/', '/a/grafana-irm-app/'],
        });
        jest.doMock('@openfeature/react-sdk', () => mockOF);

        const { getExperimentConfig, FeatureFlags } = require('./openfeature');
        const result = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);

        expect(result.variant).toBe('treatment');
        expect(result.pages).toHaveLength(2);
        expect(result.pages).toContain('/a/grafana-synthetic-monitoring-app/');
        expect(result.pages).toContain('/a/grafana-irm-app/');
      });
    });
  });
});
