/**
 * Tests for the interactive-learning banner experiment.
 *
 * Uses jest.isolateModules throughout: the module memoises the enrolled arm, and
 * the whole point of these tests is when that memo is populated.
 */

jest.mock('@grafana/runtime', () => ({ config: { namespace: 'stacks-12345' } }));

jest.mock('@openfeature/ofrep-web-provider', () => ({
  OFREPWebProvider: jest.fn().mockImplementation((config) => ({ name: 'ofrep', config })),
}));

const mockReportFeatureFlagExposure = jest.fn();
jest.mock('../openfeature-tracking', () => ({
  TrackingHook: jest.fn().mockImplementation(() => ({ after: jest.fn() })),
  reportFeatureFlagExposure: (...args: unknown[]) => mockReportFeatureFlagExposure(...args),
}));

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { FeatureFlagEvaluated: 'feature_flag_evaluated' },
}));

import { createIsolatedReactSdkMock, createIsolatedWebSdkMock } from '../../test-utils/openfeature-mock';

const FLAG = 'pathfinder.interactive-learning-banner-experiment';

const setup = (remoteValue: unknown) => {
  const mockOF = createIsolatedWebSdkMock();
  mockOF.mockClient.getObjectValue.mockImplementation((flagName: string, defaultValue: unknown) =>
    flagName === FLAG ? remoteValue : defaultValue
  );
  jest.doMock('@openfeature/web-sdk', () => mockOF);
  jest.doMock('@openfeature/react-sdk', () => createIsolatedReactSdkMock());
  return mockOF;
};

describe('interactive-learning banner experiment', () => {
  beforeEach(() => {
    localStorage.clear();
    mockReportFeatureFlagExposure.mockClear();
  });

  it('does not evaluate the flag until enrollment is requested', () => {
    jest.isolateModules(() => {
      const mockOF = setup({ variant: 'treatment' });

      const { getEnrolledInteractiveLearningBannerConfig } = require('./interactive-learning-banner');

      // The timing contract: evaluating emits the exposure, so nothing may read
      // this flag before a Pathfinder panel opens.
      expect(getEnrolledInteractiveLearningBannerConfig()).toBeNull();
      expect(mockOF.mockClient.getObjectValue).not.toHaveBeenCalled();
    });
  });

  it('enrolls on first call and reuses the memoised arm afterwards', () => {
    jest.isolateModules(() => {
      const mockOF = setup({ variant: 'treatment' });

      const {
        enrollInteractiveLearningBannerExperiment,
        getEnrolledInteractiveLearningBannerConfig,
      } = require('./interactive-learning-banner');

      expect(enrollInteractiveLearningBannerExperiment()).toEqual({ variant: 'treatment' });
      expect(enrollInteractiveLearningBannerExperiment()).toEqual({ variant: 'treatment' });
      expect(getEnrolledInteractiveLearningBannerConfig()).toEqual({ variant: 'treatment' });

      const bannerEvaluations = mockOF.mockClient.getObjectValue.mock.calls.filter(
        (call: unknown[]) => call[0] === FLAG
      );
      expect(bannerEvaluations).toHaveLength(1);
    });
  });

  it('returns the control arm unchanged', () => {
    jest.isolateModules(() => {
      setup({ variant: 'control' });

      const { enrollInteractiveLearningBannerExperiment } = require('./interactive-learning-banner');
      expect(enrollInteractiveLearningBannerExperiment()).toEqual({ variant: 'control' });
    });
  });

  it.each([
    ['an unknown variant', { variant: 'rollout' }],
    ['a missing variant', { pages: [] }],
    ['a non-object payload', 'treatment'],
    ['an array payload', [{ variant: 'treatment' }]],
    ['null', null],
  ])('falls back to excluded for %s', (_label, remoteValue) => {
    jest.isolateModules(() => {
      setup(remoteValue);
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const { enrollInteractiveLearningBannerExperiment } = require('./interactive-learning-banner');
      expect(enrollInteractiveLearningBannerExperiment()).toEqual({ variant: 'excluded' });

      consoleSpy.mockRestore();
    });
  });

  it('falls back to excluded when evaluation throws', () => {
    jest.isolateModules(() => {
      const mockOF = setup({ variant: 'treatment' });
      mockOF.mockClient.getObjectValue.mockImplementation(() => {
        throw new Error('provider exploded');
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { enrollInteractiveLearningBannerExperiment } = require('./interactive-learning-banner');
      expect(enrollInteractiveLearningBannerExperiment()).toEqual({ variant: 'excluded' });

      consoleSpy.mockRestore();
    });
  });

  it('honours a localStorage override and reports the exposure the hook would miss', () => {
    jest.isolateModules(() => {
      setup({ variant: 'excluded' });
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const { setFlagOverride } = require('../openfeature');
      const { enrollInteractiveLearningBannerExperiment } = require('./interactive-learning-banner');
      setFlagOverride(FLAG, { variant: 'treatment' });

      expect(enrollInteractiveLearningBannerExperiment()).toEqual({ variant: 'treatment' });
      // The override bypasses the client, so TrackingHook never fires for it.
      expect(mockReportFeatureFlagExposure).toHaveBeenCalledWith(FLAG, { variant: 'treatment' });

      consoleSpy.mockRestore();
    });
  });

  it('ignores a rejected override and uses the remote arm instead', () => {
    jest.isolateModules(() => {
      setup({ variant: 'control' });
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const { setFlagOverride } = require('../openfeature');
      const { enrollInteractiveLearningBannerExperiment } = require('./interactive-learning-banner');
      setFlagOverride(FLAG, { variant: 'not-an-arm' });

      expect(enrollInteractiveLearningBannerExperiment()).toEqual({ variant: 'control' });
      expect(mockReportFeatureFlagExposure).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
