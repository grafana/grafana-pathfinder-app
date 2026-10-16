import { getFeatureFlagValue } from './openfeature';
import {
  DOCS_LINK_INTERCEPTION_FLAG,
  isDocsLinkInterceptionForcedByFlag,
  resetDocsLinkInterceptionFlagCache,
} from './docs-link-interception-enablement';

jest.mock('./openfeature', () => ({
  getFeatureFlagValue: jest.fn(),
}));

const mockedGetFeatureFlagValue = getFeatureFlagValue as jest.MockedFunction<typeof getFeatureFlagValue>;

beforeEach(() => {
  jest.clearAllMocks();
  resetDocsLinkInterceptionFlagCache();
});

describe('isDocsLinkInterceptionForcedByFlag', () => {
  it('reads the flag with a false default', () => {
    mockedGetFeatureFlagValue.mockReturnValue(true);

    expect(isDocsLinkInterceptionForcedByFlag()).toBe(true);
    expect(mockedGetFeatureFlagValue).toHaveBeenCalledWith(DOCS_LINK_INTERCEPTION_FLAG, false);
  });

  it('is off when the flag is off', () => {
    mockedGetFeatureFlagValue.mockReturnValue(false);

    expect(isDocsLinkInterceptionForcedByFlag()).toBe(false);
  });

  it('reads the flag once per page load, however many renders ask', () => {
    mockedGetFeatureFlagValue.mockReturnValue(true);

    isDocsLinkInterceptionForcedByFlag();
    isDocsLinkInterceptionForcedByFlag();
    isDocsLinkInterceptionForcedByFlag();

    expect(mockedGetFeatureFlagValue).toHaveBeenCalledTimes(1);
  });
});
