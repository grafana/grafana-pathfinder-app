import { NOOP_PROVIDER, OpenFeature, type EvaluationDetails } from '@openfeature/web-sdk';

import { hasFeatureCheck } from './env';

let mockToggles: Record<string, boolean> = {};
jest.mock('@grafana/runtime', () => ({
  config: {
    get featureToggles() {
      return mockToggles;
    },
  },
}));

jest.mock('@openfeature/web-sdk', () => {
  const actual = jest.requireActual('@openfeature/web-sdk');
  return {
    ...actual,
    OpenFeature: { getProvider: jest.fn(), getClient: jest.fn() },
  };
});

const mockGetProvider = OpenFeature.getProvider as jest.Mock;
const mockGetClient = OpenFeature.getClient as jest.Mock;

function evaluateAs(details: Partial<EvaluationDetails<boolean>>) {
  const getBooleanDetails = jest.fn((flagKey: string) => ({ flagKey, flagMetadata: {}, value: false, ...details }));
  mockGetClient.mockReturnValue({ getBooleanDetails });
  return getBooleanDetails;
}

describe('hasFeatureCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockToggles = {};
    mockGetProvider.mockReturnValue({ metadata: { name: 'ofrep' } });
    evaluateAs({ errorCode: 'FLAG_NOT_FOUND' as EvaluationDetails<boolean>['errorCode'] });
  });

  it('passes when the boot toggle is on, without asking OpenFeature', async () => {
    mockToggles = { newFeature: true };
    const getBooleanDetails = evaluateAs({ value: false });

    await expect(hasFeatureCheck('has-feature:newFeature')).resolves.toEqual({
      requirement: 'has-feature:newFeature',
      pass: true,
      error: undefined,
    });
    expect(getBooleanDetails).not.toHaveBeenCalled();
  });

  it('passes on an OpenFeature true when the boot toggles are empty, as under multi-tenancy', async () => {
    const getBooleanDetails = evaluateAs({ value: true });

    const result = await hasFeatureCheck('has-feature:newFeature');

    expect(result.pass).toBe(true);
    expect(getBooleanDetails).toHaveBeenCalledWith('newFeature', false);
  });

  it('fails with the toggle error when OpenFeature evaluates false', async () => {
    evaluateAs({ value: false });

    await expect(hasFeatureCheck('has-feature:newFeature')).resolves.toEqual({
      requirement: 'has-feature:newFeature',
      pass: false,
      error: "Feature toggle 'newFeature' is not enabled",
    });
  });

  it('fails when the flag is not exposed to OpenFeature', async () => {
    const result = await hasFeatureCheck('has-feature:newFeature');

    expect(result.pass).toBe(false);
    expect(result.error).toBe("Feature toggle 'newFeature' is not enabled");
  });

  it('falls back to the boot toggles when no provider is bound', async () => {
    mockGetProvider.mockReturnValue(NOOP_PROVIDER);
    const getBooleanDetails = evaluateAs({ value: true });

    const result = await hasFeatureCheck('has-feature:newFeature');

    expect(result.pass).toBe(false);
    expect(getBooleanDetails).not.toHaveBeenCalled();
  });

  it('falls back to the boot toggles when the client throws', async () => {
    mockGetClient.mockImplementation(() => {
      throw new Error('not initialised');
    });

    const result = await hasFeatureCheck('has-feature:newFeature');

    expect(result.pass).toBe(false);
    expect(result.error).toBe("Feature toggle 'newFeature' is not enabled");
  });
});
