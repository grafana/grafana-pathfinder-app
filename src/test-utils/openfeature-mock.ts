/**
 * OpenFeature test utilities
 *
 * Use these helpers to mock OpenFeature in your tests.
 *
 * @example
 * // In your test file
 * import { mockOpenFeature, setMockFeatureFlag } from '../test-utils/openfeature-mock';
 *
 * // Setup mock before tests
 * beforeEach(() => {
 *   mockOpenFeature();
 * });
 *
 * // Set specific flag values in tests
 * it('should behave differently when flag is enabled', () => {
 *   setMockFeatureFlag('pathfinder.auto-open-sidebar', true);
 *   // ... test code
 * });
 */

import type { JsonValue } from '@openfeature/web-sdk';

// Store for mock flag values
const mockFlagValues: Record<string, boolean | string | number | JsonValue> = {};

/**
 * Set a mock feature flag value
 */
export const setMockFeatureFlag = (flagName: string, value: boolean | string | number | JsonValue): void => {
  mockFlagValues[flagName] = value;
};

/**
 * Clear all mock feature flag values
 */
export const clearMockFeatureFlags = (): void => {
  Object.keys(mockFlagValues).forEach((key) => delete mockFlagValues[key]);
};

/**
 * Get a mock feature flag value
 */
export const getMockFeatureFlag = <T extends boolean | string | number | JsonValue>(
  flagName: string,
  defaultValue: T
): T => {
  return (flagName in mockFlagValues ? mockFlagValues[flagName] : defaultValue) as T;
};

/**
 * Mock ClientProviderStatus enum matching @openfeature/web-sdk
 */
export const MockClientProviderStatus = {
  NOT_READY: 'NOT_READY',
  READY: 'READY',
  ERROR: 'ERROR',
  STALE: 'STALE',
} as const;

/**
 * Mock ProviderEvents enum matching @openfeature/web-sdk
 */
export const MockProviderEvents = {
  Ready: 'PROVIDER_READY',
  Error: 'PROVIDER_ERROR',
  ConfigurationChanged: 'PROVIDER_CONFIGURATION_CHANGED',
  Stale: 'PROVIDER_STALE',
} as const;

/**
 * Create mock for @openfeature/web-sdk
 *
 * Use this in jest.mock() calls:
 * @example
 * jest.mock('@openfeature/web-sdk', () => require('../test-utils/openfeature-mock').createWebSdkMock());
 */
export const createWebSdkMock = () => {
  const mockClient = {
    getBooleanValue: jest.fn(
      (flag: string, defaultValue: boolean) => getMockFeatureFlag(flag, defaultValue) as boolean
    ),
    getStringValue: jest.fn((flag: string, defaultValue: string) => getMockFeatureFlag(flag, defaultValue) as string),
    getNumberValue: jest.fn((flag: string, defaultValue: number) => getMockFeatureFlag(flag, defaultValue) as number),
    getObjectValue: jest.fn(
      (flag: string, defaultValue: JsonValue) => getMockFeatureFlag(flag, defaultValue) as JsonValue
    ),
    addHooks: jest.fn(),
    providerStatus: MockClientProviderStatus.READY,
    addHandler: jest.fn(),
  };

  return {
    OpenFeature: {
      setProvider: jest.fn(),
      setProviderAndWait: jest.fn().mockResolvedValue(undefined),
      getProvider: jest.fn(() => ({ name: 'mock' })),
      getClient: jest.fn(() => mockClient),
    },
    ClientProviderStatus: MockClientProviderStatus,
    ProviderEvents: MockProviderEvents,
    mockClient, // Export for direct access in tests
  };
};

/**
 * Create mock for @openfeature/react-sdk
 *
 * Use this in jest.mock() calls:
 * @example
 * jest.mock('@openfeature/react-sdk', () => require('../test-utils/openfeature-mock').createReactSdkMock());
 */
export const createReactSdkMock = () => {
  return {
    OpenFeatureProvider: ({ children }: { children: React.ReactNode }) => children,
    useBooleanFlagValue: jest.fn(
      (flag: string, defaultValue: boolean) => getMockFeatureFlag(flag, defaultValue) as boolean
    ),
    useStringFlagValue: jest.fn(
      (flag: string, defaultValue: string) => getMockFeatureFlag(flag, defaultValue) as string
    ),
    useNumberFlagValue: jest.fn(
      (flag: string, defaultValue: number) => getMockFeatureFlag(flag, defaultValue) as number
    ),
  };
};

/**
 * Setup OpenFeature mock with default values
 *
 * Call this in beforeEach() to reset mock state
 */
export const mockOpenFeature = (): void => {
  clearMockFeatureFlags();
};
