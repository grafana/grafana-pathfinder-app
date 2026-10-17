import { getFeatureFlagValue } from './openfeature';
import {
  isSectionRecoveryEnabled,
  resetSectionRecoveryFlagCache,
  SECTION_RECOVERY_FLAG,
} from './section-recovery-enablement';

jest.mock('./openfeature', () => ({ getFeatureFlagValue: jest.fn() }));

const mocked = getFeatureFlagValue as jest.MockedFunction<typeof getFeatureFlagValue>;

beforeEach(() => {
  jest.clearAllMocks();
  resetSectionRecoveryFlagCache();
});

it('is on by default and reads the flag once per page load', () => {
  mocked.mockReturnValue(true);
  expect(isSectionRecoveryEnabled()).toBe(true);
  expect(isSectionRecoveryEnabled()).toBe(true);
  expect(mocked).toHaveBeenCalledTimes(1);
  expect(mocked).toHaveBeenCalledWith(SECTION_RECOVERY_FLAG, true);
});

it('turns recovery off when the kill switch is flipped', () => {
  mocked.mockReturnValue(false);
  expect(isSectionRecoveryEnabled()).toBe(false);
});
