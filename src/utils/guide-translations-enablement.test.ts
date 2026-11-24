import { getFeatureFlagValue } from './openfeature';
import {
  GUIDE_TRANSLATIONS_FLAG,
  isGuideTranslationsEnabled,
  resetGuideTranslationsFlagCache,
} from './guide-translations-enablement';

jest.mock('./openfeature', () => ({ getFeatureFlagValue: jest.fn() }));

const mocked = getFeatureFlagValue as jest.MockedFunction<typeof getFeatureFlagValue>;

beforeEach(() => {
  jest.clearAllMocks();
  resetGuideTranslationsFlagCache();
});

it('is off by default and reads the flag once per page load', () => {
  mocked.mockImplementation((_flag, defaultValue) => defaultValue);
  expect(isGuideTranslationsEnabled()).toBe(false);
  expect(isGuideTranslationsEnabled()).toBe(false);
  expect(mocked).toHaveBeenCalledTimes(1);
  expect(mocked).toHaveBeenCalledWith(GUIDE_TRANSLATIONS_FLAG, false);
});

it('reads the flag again after the cache is reset', () => {
  mocked.mockReturnValue(false);
  expect(isGuideTranslationsEnabled()).toBe(false);
  mocked.mockReturnValue(true);
  expect(isGuideTranslationsEnabled()).toBe(false);
  resetGuideTranslationsFlagCache();
  expect(isGuideTranslationsEnabled()).toBe(true);
  expect(mocked).toHaveBeenCalledTimes(2);
});

it('turns on when the flag is enabled for the stack', () => {
  mocked.mockReturnValue(true);
  expect(isGuideTranslationsEnabled()).toBe(true);
});

it('names the registered flag', () => {
  expect(GUIDE_TRANSLATIONS_FLAG).toBe('pathfinder.guide-translations');
});
