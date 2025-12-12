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

// Store for mock flag values
const mockFlagValues: Record<string, boolean | string | number> = {};

/**
 * Set a mock feature flag value
 */
export const setMockFeatureFlag = (flagName: string, value: boolean | string | number): void => {
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
export const getMockFeatureFlag = (
  flagName: string,
  defaultValue: boolean | string | number
): boolean | string | number => {
  return flagName in mockFlagValues ? mockFlagValues[flagName] : defaultValue;
};

/**
 * Create mock for @openfeature/react-sdk
 *
 * Use this in jest.mock() calls:
 * @example
 * jest.mock('@openfeature/react-sdk', () => require('../test-utils/openfeature-mock').createOpenFeatureMock());
 */
export const createOpenFeatureMock = () => {
  const mockClient = {
    getBooleanValue: jest.fn(
      (flag: string, defaultValue: boolean) => getMockFeatureFlag(flag, defaultValue) as boolean
    ),
    getStringValue: jest.fn((flag: string, defaultValue: string) => getMockFeatureFlag(flag, defaultValue) as string),
    getNumberValue: jest.fn((flag: string, defaultValue: number) => getMockFeatureFlag(flag, defaultValue) as number),
  };

  return {
    OpenFeature: {
      setProvider: jest.fn(),
      getProvider: jest.fn(() => ({ name: 'mock' })),
      getClient: jest.fn(() => mockClient),
    },
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
