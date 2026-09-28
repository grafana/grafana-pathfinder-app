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

const HIGHLIGHTED_GUIDE_FLAG = 'pathfinder.highlighted-guide-experiment';
const BANNER_FLAG = 'pathfinder.interactive-learning-banner-experiment';

const HIGHLIGHTED_GUIDE_TREATMENT = {
  variant: 'treatment',
  pages: ['/a/grafana-irm-app*'],
  guideId: 'https://interactive-learning.grafana.net/packages/grafana-irm-configuration-lj/content.json',
  autoOpen: true,
  docType: 'learning-journey',
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

  it('returns only the enrolled experiment, dropping excluded arms', () => {
    jest.isolateModules(() => {
      setup({ [HIGHLIGHTED_GUIDE_FLAG]: HIGHLIGHTED_GUIDE_TREATMENT });

      const { getActiveExperiments } = require('./active-experiments');

      expect(getActiveExperiments()).toEqual([
        { flag: HIGHLIGHTED_GUIDE_FLAG, ...HIGHLIGHTED_GUIDE_TREATMENT, resetCache: false },
      ]);
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
      setup({
        [HIGHLIGHTED_GUIDE_FLAG]: HIGHLIGHTED_GUIDE_TREATMENT,
        [BANNER_FLAG]: { variant: 'treatment' },
      });

      const { enrollInteractiveLearningBannerExperiment } = require('./interactive-learning-banner');
      const { getActiveExperiments } = require('./active-experiments');

      enrollInteractiveLearningBannerExperiment();
      expect(getActiveExperiments().map((entry: { flag: string }) => entry.flag)).toEqual([
        HIGHLIGHTED_GUIDE_FLAG,
        BANNER_FLAG,
      ]);
    });
  });
});
