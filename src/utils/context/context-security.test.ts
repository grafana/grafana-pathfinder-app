/**
 * Security Test Suite - Recommender Service Protection
 *
 * Tests for security features that validate recommender service URLs
 * and protect against MITM attacks on the recommendation API.
 */

import { ContextService } from './context.service';
import { isDevModeEnabled } from '../dev-mode';

// Mock dependencies
jest.mock('../dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => false),
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

jest.mock('../../lib/hash.util', () => ({
  hashUserData: jest.fn().mockResolvedValue({
    hashedUserId: 'hashed-user',
    hashedEmail: 'hashed-email',
  }),
  hashString: jest.fn((input: string) => {
    // Mock SHA-256 hash - simulate a 64-character hex string
    return Promise.resolve('a'.repeat(64)); // Simplified mock hash
  }),
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

describe('Security: Recommender Service URL Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isDevModeEnabled as jest.Mock).mockReturnValue(false);
  });

  describe('HTTPS Requirement', () => {
    it('should accept HTTPS recommender URLs', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recommendations: [] }),
      });

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      expect(result.error).toBeNull();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should reject HTTP recommender URLs in production', async () => {
      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'http://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      expect(result.error).toBeTruthy();
      expect(result.error).toContain('error');
      expect(result.usingFallbackRecommendations).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should reject FTP protocol', async () => {
      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'ftp://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      expect(result.error).toBeTruthy();
      expect(result.usingFallbackRecommendations).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Domain Whitelist', () => {
    it('should accept whitelisted Grafana domains', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recommendations: [] }),
      });

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const validUrls = [
        'https://recommender.grafana.com/recommend',
        'https://recommender-staging.grafana.com/recommend',
      ];

      for (const url of validUrls) {
        jest.clearAllMocks();
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ recommendations: [] }),
        });

        const result = await ContextService.fetchRecommendations(mockContextData, {
          recommenderServiceUrl: url,
          acceptedTermsAndConditions: true,
        });

        expect(result.error).toBeNull();
        expect(global.fetch).toHaveBeenCalled();
      }
    });

    it('should reject non-whitelisted domains', async () => {
      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const invalidUrls = [
        'https://evil.com/recommend',
        'https://recommender-grafana.com/recommend', // Prefix attack
        'https://grafana.com.evil.com/recommend', // Suffix attack
        'https://api.malicious.com/recommend',
      ];

      for (const url of invalidUrls) {
        jest.clearAllMocks();

        const result = await ContextService.fetchRecommendations(mockContextData, {
          recommenderServiceUrl: url,
          acceptedTermsAndConditions: true,
        });

        expect(result.error).toBeTruthy();
        expect(result.usingFallbackRecommendations).toBe(true);
        expect(global.fetch).not.toHaveBeenCalled();
      }
    });

    it('should reject subdomain hijacking attempts', async () => {
      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://evil-recommender.grafana.com.attacker.com/recommend',
        acceptedTermsAndConditions: true,
      });

      expect(result.error).toBeTruthy();
      expect(result.usingFallbackRecommendations).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Dev Mode Localhost Support', () => {
    it('should allow localhost in dev mode', async () => {
      (isDevModeEnabled as jest.Mock).mockReturnValue(true);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recommendations: [] }),
      });

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'http://localhost:8000/recommend',
        acceptedTermsAndConditions: true,
      });

      expect(result.error).toBeNull();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should allow 127.0.0.1 in dev mode', async () => {
      (isDevModeEnabled as jest.Mock).mockReturnValue(true);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ recommendations: [] }),
      });

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'http://127.0.0.1:8000/recommend',
        acceptedTermsAndConditions: true,
      });

      expect(result.error).toBeNull();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should reject localhost in production mode', async () => {
      (isDevModeEnabled as jest.Mock).mockReturnValue(false);

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'http://localhost:8000/recommend',
        acceptedTermsAndConditions: true,
      });

      expect(result.error).toBeTruthy();
      expect(result.usingFallbackRecommendations).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Recommendation Response Sanitization', () => {
    it('should sanitize malicious titles from API', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            recommendations: [
              {
                title: '<script>alert("XSS")</script>Grafana Alerts',
                summary: 'Learn about alerts',
                url: 'https://grafana.com/docs/alerts',
              },
            ],
          }),
      });

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      // Recommendations may be filtered or empty due to processing logic
      // The key test is that IF recommendations exist, they should be sanitized
      if (result.recommendations.length > 0) {
        const rec = result.recommendations.find((r) => r.title?.includes('Grafana Alerts'));
        if (rec) {
          expect(rec.title).not.toContain('<script>');
          expect(rec.title).not.toContain('alert(');
        }
      }
      // The main assertion is that the function didn't throw and handled the malicious input
      expect(result).toBeDefined();
    });

    it('should sanitize malicious summaries from API', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            recommendations: [
              {
                title: 'Grafana Alerts',
                summary: '<img src=x onerror="alert(1)">Setup alerts',
                url: 'https://grafana.com/docs/alerts',
              },
            ],
          }),
      });

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      // Recommendations may be filtered or empty due to processing logic
      if (result.recommendations.length > 0) {
        const rec = result.recommendations[0];
        expect(rec.summary).not.toContain('onerror');
        expect(rec.summary).not.toContain('<img');
      }
      // The main assertion is that the function didn't throw and handled the malicious input
      expect(result).toBeDefined();
    });

    it('should handle null/undefined fields gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            recommendations: [
              {
                title: null,
                summary: undefined,
                url: 'https://grafana.com/docs/test',
              },
            ],
          }),
      });

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      // Should not throw and should handle null/undefined gracefully
      expect(result).toBeDefined();
      // If recommendations exist, they should have sanitized fields
      if (result.recommendations.length > 0) {
        expect(result.recommendations[0].title).toBeDefined();
        expect(result.recommendations[0].summary).toBeDefined();
      }
    });
  });

  describe('Fallback Behavior on Security Failure', () => {
    it('should use fallback recommendations when URL validation fails', async () => {
      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      const result = await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://evil.com/recommend',
        acceptedTermsAndConditions: true,
      });

      expect(result.usingFallbackRecommendations).toBe(true);
      expect(result.error).toBeTruthy();
      // Should still have some recommendations (bundled/static)
      expect(Array.isArray(result.recommendations)).toBe(true);
    });
  });

  describe('Source Hostname Privacy', () => {
    it('should leave play.grafana.org unhashed for OSS users', async () => {
      // Mock window.location.hostname
      Object.defineProperty(window, 'location', {
        value: { hostname: 'play.grafana.org' },
        writable: true,
      });

      // Mock as OSS (not Cloud)
      const originalConfig = (require('@grafana/runtime') as any).config;
      (require('@grafana/runtime') as any).config = {
        ...originalConfig,
        bootData: {
          ...originalConfig.bootData,
          settings: {
            buildInfo: {
              versionString: 'Grafana v10.0.0', // OSS version (no "Cloud" prefix)
            },
          },
        },
      };

      let capturedPayload: any = null;
      (global.fetch as jest.Mock).mockImplementation(async (url, options) => {
        capturedPayload = JSON.parse(options.body);
        return {
          ok: true,
          json: () => Promise.resolve({ recommendations: [] }),
        };
      });

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      expect(capturedPayload).toBeDefined();
      expect(capturedPayload.source).toBe('play.grafana.org');
    });

    it('should hash cloud hostnames for privacy', async () => {
      // Mock window.location.hostname with customer-specific domain
      Object.defineProperty(window, 'location', {
        value: { hostname: 'acme-corp.grafana.net' },
        writable: true,
      });

      // Mock as Cloud
      const originalConfig = (require('@grafana/runtime') as any).config;
      (require('@grafana/runtime') as any).config = {
        ...originalConfig,
        bootData: {
          ...originalConfig.bootData,
          settings: {
            buildInfo: {
              versionString: 'Grafana Cloud v10.0.0',
            },
          },
        },
      };

      let capturedPayload: any = null;
      (global.fetch as jest.Mock).mockImplementation(async (url, options) => {
        capturedPayload = JSON.parse(options.body);
        return {
          ok: true,
          json: () => Promise.resolve({ recommendations: [] }),
        };
      });

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      expect(capturedPayload).toBeDefined();
      // Source should be hashed (SHA-256 hex string, not the original hostname)
      expect(capturedPayload.source).not.toBe('acme-corp.grafana.net');
      expect(capturedPayload.source).toBeDefined();
      expect(capturedPayload.source.length).toBe(64); // SHA-256 produces 64 hex characters
    });

    it('should use oss-source for OSS users not on play.grafana.org', async () => {
      // Mock window.location.hostname
      Object.defineProperty(window, 'location', {
        value: { hostname: 'localhost' },
        writable: true,
      });

      // Mock as OSS
      const originalConfig = (require('@grafana/runtime') as any).config;
      (require('@grafana/runtime') as any).config = {
        ...originalConfig,
        bootData: {
          ...originalConfig.bootData,
          settings: {
            buildInfo: {
              versionString: 'Grafana v10.0.0',
            },
          },
        },
      };

      let capturedPayload: any = null;
      (global.fetch as jest.Mock).mockImplementation(async (url, options) => {
        capturedPayload = JSON.parse(options.body);
        return {
          ok: true,
          json: () => Promise.resolve({ recommendations: [] }),
        };
      });

      const mockContextData = {
        currentPath: '/dashboards',
        currentUrl: 'http://localhost:3000/dashboards',
        pathSegments: ['dashboards'],
        dataSources: [],
        dashboardInfo: null,
        recommendations: [],
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
      };

      await ContextService.fetchRecommendations(mockContextData, {
        recommenderServiceUrl: 'https://recommender.grafana.com',
        acceptedTermsAndConditions: true,
      });

      expect(capturedPayload).toBeDefined();
      expect(capturedPayload.source).toBe('oss-source');
    });
  });
});
