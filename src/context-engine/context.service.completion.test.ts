/**
 * Tests for completion percentage storage selection in ContextService.
 *
 * These tests verify that:
 * - Learning journeys read completion from journeyCompletionStorage
 * - Interactive guides read completion from interactiveCompletionStorage
 * - Bundled interactives are handled separately (skipped in processLearningJourneys)
 *
 * This prevents regression of the bug where all recommendation types
 * incorrectly read from journeyCompletionStorage.
 */

import { ContextService } from './context.service';
import { interactiveCompletionStorage } from '../lib/user-storage';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';
import { fetchContent, getJourneyCompletionPercentageAsync } from '../docs-retrieval';

// Mock dependencies
jest.mock('../utils/dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => false),
  isDevModeEnabledGlobal: jest.fn(() => false),
}));

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
  })),
  config: {
    bootData: {
      settings: {
        buildInfo: {
          versionString: 'Grafana v10.0.0',
        },
      },
      user: {
        analytics: {
          identifier: 'test-user',
        },
        email: 'test@example.com',
        orgRole: 'Admin',
      },
    },
  },
  locationService: {
    push: jest.fn(),
  },
  getEchoSrv: jest.fn(() => ({
    addEvent: jest.fn(),
  })),
  EchoEventType: {
    Interaction: 'interaction',
  },
}));

jest.mock('../lib/hash.util', () => ({
  hashUserData: jest.fn().mockResolvedValue({
    hashedUserId: 'hashed-user',
    hashedEmail: 'hashed-email',
  }),
  hashString: jest.fn((input: string) => Promise.resolve('a'.repeat(64))),
}));

// Mock user storage modules
jest.mock('../lib/user-storage', () => ({
  interactiveCompletionStorage: {
    get: jest.fn(),
    set: jest.fn(),
  },
  journeyCompletionStorage: {
    get: jest.fn(),
    set: jest.fn(),
  },
  tabStorage: {
    get: jest.fn(),
    set: jest.fn(),
  },
  useUserStorage: jest.fn(),
}));

// Mock docs-retrieval module
jest.mock('../docs-retrieval', () => ({
  fetchContent: jest.fn(),
  getJourneyCompletionPercentageAsync: jest.fn(),
}));

// Mock fetch globally
global.fetch = jest.fn();

// Mock AbortSignal.timeout for Node environments that don't support it
if (!AbortSignal.timeout) {
  (AbortSignal as any).timeout = jest.fn((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
}

describe('ContextService: Completion Percentage Storage Selection', () => {
  const mockContextData = {
    currentPath: '/dashboards',
    currentUrl: 'http://localhost:3000/dashboards',
    pathSegments: ['dashboards'],
    dataSources: [],
    dashboardInfo: null,
    recommendations: [],
    featuredRecommendations: [],
    tags: [],
    isLoading: false,
    recommendationsError: null,
    recommendationsErrorType: null,
    usingFallbackRecommendations: false,
    visualizationType: null,
    grafanaVersion: '10.0.0',
    theme: 'dark',
    timestamp: new Date().toISOString(),
    searchParams: {},
    platform: 'oss' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (isDevModeEnabledGlobal as jest.Mock).mockReturnValue(false);

    // Default mock implementations
    (fetchContent as jest.Mock).mockResolvedValue({
      content: {
        metadata: {
          learningJourney: {
            milestones: [],
            summary: 'Test summary',
          },
        },
      },
    });
  });

  describe('Learning Journey Completion', () => {
    it('should read completion percentage from journeyCompletionStorage for learning-journey type', async () => {
      const journeyUrl = 'https://grafana.com/docs/grafana/latest/getting-started/';
      const expectedCompletion = 75;

      // Setup mocks
      (getJourneyCompletionPercentageAsync as jest.Mock).mockResolvedValue(expectedCompletion);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            recommendations: [
              {
                title: 'Getting Started with Grafana',
                summary: 'Learn Grafana basics',
                url: journeyUrl,
                type: 'learning-journey',
              },
            ],
          }),
      });

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      // Verify journeyCompletionStorage was used (via getJourneyCompletionPercentageAsync)
      expect(getJourneyCompletionPercentageAsync).toHaveBeenCalledWith(journeyUrl);

      // Verify interactiveCompletionStorage was NOT called for this recommendation
      // (it may be called for bundled interactives, so we check the specific URL was not used)
      const interactiveCalls = (interactiveCompletionStorage.get as jest.Mock).mock.calls;
      const calledWithJourneyUrl = interactiveCalls.some((call: string[]) => call[0] === journeyUrl);
      expect(calledWithJourneyUrl).toBe(false);

      // Verify the completion percentage was returned correctly
      const journeyRec = result.recommendations.find((r) => r.url === journeyUrl);
      if (journeyRec) {
        expect(journeyRec.completionPercentage).toBe(expectedCompletion);
      }
    });

    it('should use journeyCompletionStorage when fetch fails for learning-journey type', async () => {
      const journeyUrl = 'https://grafana.com/docs/grafana/latest/alerting/';
      const expectedCompletion = 50;

      // Setup fetchContent to fail
      (fetchContent as jest.Mock).mockRejectedValue(new Error('Network error'));
      (getJourneyCompletionPercentageAsync as jest.Mock).mockResolvedValue(expectedCompletion);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            recommendations: [
              {
                title: 'Alerting in Grafana',
                summary: 'Learn alerting',
                url: journeyUrl,
                type: 'learning-journey',
              },
            ],
          }),
      });

      await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      // Should still use journeyCompletionStorage in the error handler
      expect(getJourneyCompletionPercentageAsync).toHaveBeenCalledWith(journeyUrl);
    });
  });

  describe('Interactive Guide Completion', () => {
    it('should read completion percentage from interactiveCompletionStorage for interactive type', async () => {
      const interactiveUrl = 'https://interactive-learning.grafana.net/guides/dashboards';
      const expectedCompletion = 60;

      // Setup mocks
      (interactiveCompletionStorage.get as jest.Mock).mockResolvedValue(expectedCompletion);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            recommendations: [
              {
                title: 'Interactive Dashboard Guide',
                summary: 'Learn dashboards interactively',
                url: interactiveUrl,
                type: 'interactive',
              },
            ],
          }),
      });

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      // Verify interactiveCompletionStorage was called with the interactive URL
      expect(interactiveCompletionStorage.get).toHaveBeenCalledWith(interactiveUrl);

      // Verify journeyCompletionStorage was NOT called for this URL
      const journeyCalls = (getJourneyCompletionPercentageAsync as jest.Mock).mock.calls;
      const calledWithInteractiveUrl = journeyCalls.some((call: string[]) => call[0] === interactiveUrl);
      expect(calledWithInteractiveUrl).toBe(false);

      // Verify the completion percentage was returned correctly
      const interactiveRec = result.recommendations.find((r) => r.url === interactiveUrl);
      if (interactiveRec) {
        expect(interactiveRec.completionPercentage).toBe(expectedCompletion);
      }
    });

    it('should use interactiveCompletionStorage when fetch fails for interactive type', async () => {
      const interactiveUrl = 'https://interactive-learning.grafana.net/guides/alerts';
      const expectedCompletion = 30;

      // Setup fetchContent to fail
      (fetchContent as jest.Mock).mockRejectedValue(new Error('Network error'));
      (interactiveCompletionStorage.get as jest.Mock).mockResolvedValue(expectedCompletion);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            recommendations: [
              {
                title: 'Interactive Alerts Guide',
                summary: 'Learn alerts interactively',
                url: interactiveUrl,
                type: 'interactive',
              },
            ],
          }),
      });

      await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      // Should still use interactiveCompletionStorage in the error handler
      expect(interactiveCompletionStorage.get).toHaveBeenCalledWith(interactiveUrl);
    });
  });

  describe('Bundled Interactives', () => {
    it('should skip bundled interactives in processLearningJourneys (handled elsewhere)', async () => {
      const bundledUrl = 'bundled:getting-started-guide';

      // Setup mocks - bundled interactives should not trigger storage lookups in processLearningJourneys
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            recommendations: [
              {
                title: 'Bundled Getting Started',
                summary: 'Bundled guide',
                url: bundledUrl,
                type: 'interactive',
              },
            ],
          }),
      });

      await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      // Verify that journeyCompletionStorage was NOT called with the bundled URL
      // (bundled interactives are skipped in processLearningJourneys and handled by buildBundledInteractiveRecommendations)
      const journeyCalls = (getJourneyCompletionPercentageAsync as jest.Mock).mock.calls;
      const journeyCalledWithBundled = journeyCalls.some((call: string[]) => call[0] === bundledUrl);
      expect(journeyCalledWithBundled).toBe(false);
    });
  });

  describe('Mixed Recommendation Types', () => {
    it('should use correct storage for each recommendation type in a mixed list', async () => {
      const journeyUrl = 'https://grafana.com/docs/learning-path';
      const interactiveUrl = 'https://interactive-learning.grafana.net/guide';
      const docsUrl = 'https://grafana.com/docs/reference';

      // Setup mocks with distinct completion values
      (getJourneyCompletionPercentageAsync as jest.Mock).mockResolvedValue(80);
      (interactiveCompletionStorage.get as jest.Mock).mockResolvedValue(40);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            recommendations: [
              {
                title: 'Learning Journey',
                url: journeyUrl,
                type: 'learning-journey',
              },
              {
                title: 'Interactive Guide',
                url: interactiveUrl,
                type: 'interactive',
              },
              {
                title: 'Docs Page',
                url: docsUrl,
                type: 'docs-page',
              },
            ],
          }),
      });

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      // Verify learning journey used journeyCompletionStorage
      expect(getJourneyCompletionPercentageAsync).toHaveBeenCalledWith(journeyUrl);

      // Verify interactive used interactiveCompletionStorage
      expect(interactiveCompletionStorage.get).toHaveBeenCalledWith(interactiveUrl);

      // Verify docs-page type was not processed for completion (it should be skipped)
      const journeyCalls = (getJourneyCompletionPercentageAsync as jest.Mock).mock.calls;
      const interactiveCalls = (interactiveCompletionStorage.get as jest.Mock).mock.calls;

      const journeyCalledWithDocs = journeyCalls.some((call: string[]) => call[0] === docsUrl);
      const interactiveCalledWithDocs = interactiveCalls.some((call: string[]) => call[0] === docsUrl);

      expect(journeyCalledWithDocs).toBe(false);
      expect(interactiveCalledWithDocs).toBe(false);

      // Verify completion percentages are correct for each type
      const journeyRec = result.recommendations.find((r) => r.type === 'learning-journey');
      const interactiveRec = result.recommendations.find((r) => r.type === 'interactive');

      if (journeyRec) {
        expect(journeyRec.completionPercentage).toBe(80);
      }
      if (interactiveRec) {
        expect(interactiveRec.completionPercentage).toBe(40);
      }
    });
  });
});
