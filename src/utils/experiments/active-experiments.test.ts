jest.mock('@grafana/runtime', () => ({ config: { namespace: 'stacks-12345' } }));

jest.mock('@openfeature/ofrep-web-provider', () => ({
  OFREPWebProvider: jest.fn().mockImplementation((config) => ({ name: 'ofrep', config })),
}));

jest.mock('../openfeature-tracking', () => ({
  TrackingHook: jest.fn().mockImplementation(() => ({ after: jest.fn() })),
  reportFeatureFlagExposure: jest.fn(),
}));

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { FeatureFlagEvaluated: 'feature_flag_evaluated' },
}));

import { createIsolatedReactSdkMock, createIsolatedWebSdkMock } from '../../test-utils/openfeature-mock';

const AUTO_OPEN_GUIDE_FLAG = 'pathfinder.auto-open-guide-experiment';
const BANNER_FLAG = 'pathfinder.interactive-learning-banner-experiment';

const AUTO_OPEN_GUIDE_ENROLLMENT = {
  variant: 'treatment',
  experiences: [{ guide: 'bundled:first-dashboard', pages: ['/explore*'] }],
};

const setup = (values: Record<string, unknown>) => {
  const mockOF = createIsolatedWebSdkMock();
  mockOF.mockClient.getObjectValue.mockImplementation(
    (flagName: string) => values[flagName] ?? { variant: 'excluded' }
  );
  jest.doMock('@openfeature/web-sdk', () => mockOF);
  jest.doMock('@openfeature/react-sdk', () => createIsolatedReactSdkMock());
  return mockOF;
};

describe('getActiveExperiments', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('omits the auto-open guide arm until activation, and never evaluates it itself', () => {
    jest.isolateModules(() => {
      const mockOF = setup({ [AUTO_OPEN_GUIDE_FLAG]: AUTO_OPEN_GUIDE_ENROLLMENT });

      const { getActiveExperiments } = require('./active-experiments');

      expect(getActiveExperiments()).toEqual([]);
      expect(mockOF.mockClient.getObjectValue).not.toHaveBeenCalledWith(AUTO_OPEN_GUIDE_FLAG, expect.anything());
    });
  });

  it('includes the auto-open guide arm once activated', () => {
    jest.isolateModules(() => {
      setup({});

      const { setAutoOpenGuideEnrollment } = require('./auto-open-guide/state');
      const { getActiveExperiments } = require('./active-experiments');

      setAutoOpenGuideEnrollment(AUTO_OPEN_GUIDE_ENROLLMENT);
      expect(getActiveExperiments()).toEqual([{ flag: AUTO_OPEN_GUIDE_FLAG, variant: 'treatment' }]);
    });
  });

  it('returns an empty array when no experiment is enrolled', () => {
    jest.isolateModules(() => {
      setup({});

      const { getActiveExperiments } = require('./active-experiments');
      expect(getActiveExperiments()).toEqual([]);
    });
  });

  it('omits the banner arm until it is enrolled, and never evaluates it itself', () => {
    jest.isolateModules(() => {
      const mockOF = setup({ [BANNER_FLAG]: { variant: 'treatment' } });

      const { getActiveExperiments } = require('./active-experiments');

      expect(getActiveExperiments()).toEqual([]);
      // Enrichment runs on every analytics event; evaluating here would enroll
      // users who never opened Pathfinder.
      expect(mockOF.mockClient.getObjectValue).not.toHaveBeenCalledWith(BANNER_FLAG, expect.anything());
    });
  });

  it('includes the banner arm once enrolled', () => {
    jest.isolateModules(() => {
      setup({ [BANNER_FLAG]: { variant: 'control' } });

      const { enrollInteractiveLearningBannerExperiment } = require('./interactive-learning-banner');
      const { getActiveExperiments } = require('./active-experiments');

      enrollInteractiveLearningBannerExperiment();
      expect(getActiveExperiments()).toEqual([{ flag: BANNER_FLAG, variant: 'control' }]);
    });
  });

  it('drops an excluded banner arm even after enrollment', () => {
    jest.isolateModules(() => {
      setup({ [BANNER_FLAG]: { variant: 'excluded' } });

      const { enrollInteractiveLearningBannerExperiment } = require('./interactive-learning-banner');
      const { getActiveExperiments } = require('./active-experiments');

      enrollInteractiveLearningBannerExperiment();
      expect(getActiveExperiments()).toEqual([]);
    });
  });

  it('reports both arms when the user is enrolled in each', () => {
    jest.isolateModules(() => {
      setup({ [BANNER_FLAG]: { variant: 'treatment' } });

      const { setAutoOpenGuideEnrollment } = require('./auto-open-guide/state');
      const { enrollInteractiveLearningBannerExperiment } = require('./interactive-learning-banner');
      const { getActiveExperiments } = require('./active-experiments');

      setAutoOpenGuideEnrollment(AUTO_OPEN_GUIDE_ENROLLMENT);
      enrollInteractiveLearningBannerExperiment();
      expect(getActiveExperiments().map((entry: { flag: string }) => entry.flag)).toEqual([
        AUTO_OPEN_GUIDE_FLAG,
        BANNER_FLAG,
      ]);
    });
  });
});
