/**
 * Unit tests for tab storage restore module
 */

import {
  restoreTabsFromStorage,
  restoreActiveTabFromStorage,
  mergeRestoredTabsWithExisting,
  createUrlValidator,
  TabStorage,
} from './tab-storage-restore';
import {
  LearningJourneyTab,
  PathContext,
  PendingAlignment,
  PersistedTabData,
} from '../../../types/content-panel.types';
import type { RawContent } from '../../../types/content.types';

// Mock TabStorage
const createMockTabStorage = (tabs: PersistedTabData[] | null = null, activeTab: string | null = null): TabStorage => ({
  getTabs: jest.fn().mockResolvedValue(tabs),
  setTabs: jest.fn().mockResolvedValue(undefined),
  getActiveTab: jest.fn().mockResolvedValue(activeTab),
  setActiveTab: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockResolvedValue(undefined),
});

describe('tab-storage-restore', () => {
  describe('createUrlValidator', () => {
    it('should validate allowed content URLs', () => {
      const validator = createUrlValidator(false);
      expect(validator('https://grafana.com/docs/grafana/latest/')).toBe(true);
    });

    it('should reject localhost URLs when dev mode is disabled', () => {
      const validator = createUrlValidator(false);
      expect(validator('http://localhost:3000/test')).toBe(false);
    });

    it('should allow localhost URLs when dev mode is enabled', () => {
      const validator = createUrlValidator(true);
      expect(validator('http://localhost:3000/test')).toBe(true);
    });

    it('should reject GitHub raw URLs when dev mode is disabled', () => {
      const validator = createUrlValidator(false);
      expect(validator('https://raw.githubusercontent.com/grafana/test/main/doc.md')).toBe(false);
    });

    it('should allow GitHub raw URLs when dev mode is enabled', () => {
      const validator = createUrlValidator(true);
      expect(validator('https://raw.githubusercontent.com/grafana/test/main/doc.md')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      const validator = createUrlValidator(false);
      expect(validator('javascript:alert(1)')).toBe(false);
      expect(validator('data:text/html,<script>alert(1)</script>')).toBe(false);
    });
  });

  describe('restoreTabsFromStorage', () => {
    it('should return recommendations tab when storage is empty', async () => {
      const storage = createMockTabStorage(null);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      expect(tabs).toHaveLength(1);
      expect(tabs[0]!.id).toBe('recommendations');
    });

    it('should return recommendations tab when storage returns empty array', async () => {
      const storage = createMockTabStorage([]);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      expect(tabs).toHaveLength(1);
      expect(tabs[0]!.id).toBe('recommendations');
    });

    it('should restore valid learning journey tabs', async () => {
      const persistedTabs: PersistedTabData[] = [
        {
          id: 'tab-1',
          title: 'Test Journey',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          currentUrl: 'https://grafana.com/docs/grafana/latest/test/page1/',
          type: 'learning-journey',
        },
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      expect(tabs).toHaveLength(2); // recommendations + restored tab
      expect(tabs[0]!.id).toBe('recommendations');
      expect(tabs[1]!.id).toBe('tab-1');
      expect(tabs[1]!.title).toBe('Test Journey');
      expect(tabs[1]!.baseUrl).toBe('https://grafana.com/docs/grafana/latest/test/');
      expect(tabs[1]!.currentUrl).toBe('https://grafana.com/docs/grafana/latest/test/page1/');
      expect(tabs[1]!.type).toBe('learning-journey');
    });

    it('should restore devtools tab without URL validation', async () => {
      const persistedTabs: PersistedTabData[] = [
        {
          id: 'devtools',
          title: 'Dev Tools',
          baseUrl: '',
          currentUrl: '',
          type: 'devtools',
        },
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      expect(tabs).toHaveLength(2); // recommendations + devtools
      expect(tabs[1]!.id).toBe('devtools');
      expect(tabs[1]!.type).toBe('devtools');
    });

    it('rejects noncanonical reserved IDs and unknown persisted types', async () => {
      const persistedTabs: PersistedTabData[] = [
        {
          id: 'devtools',
          title: 'Disguised Dev Tools',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          type: 'docs',
        },
        {
          id: 'tab-1',
          title: 'Disguised docs tab',
          baseUrl: '',
          type: 'devtools',
        },
        {
          id: 'editor',
          title: 'Disguised editor',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          type: 'docs',
        },
        {
          id: 'tab-1',
          title: 'Content claiming editor privileges',
          baseUrl: '',
          type: 'editor',
        },
        {
          id: 'tab-2',
          title: 'Garbage kind',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          type: 'not-a-real-kind' as PersistedTabData['type'],
        },
        {
          id: 'tab-3',
          title: 'Numeric kind',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          // Simulate tampered storage that bypassed TypeScript.
          type: 42 as unknown as PersistedTabData['type'],
        },
        {
          id: 'recommendations',
          title: 'Disguised home',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          type: 'docs',
        },
        {
          id: 'tab-4',
          title: 'Content claiming home',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          type: 'recommendations',
        },
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      expect(tabs).toEqual([expect.objectContaining({ id: 'recommendations', type: 'recommendations' })]);
    });

    it('keeps the first record when persisted tab IDs are duplicated', async () => {
      const persistedTabs: PersistedTabData[] = [
        { id: 'devtools', title: 'Dev Tools', baseUrl: '', currentUrl: '', type: 'devtools' },
        { id: 'devtools', title: 'Dev Tools again', baseUrl: '', currentUrl: '', type: 'devtools' },
        { id: 'editor', title: 'First guide', baseUrl: '', currentUrl: '', type: 'editor' },
        { id: 'editor', title: 'Second guide', baseUrl: '', currentUrl: '', type: 'editor' },
        {
          id: 'tab-1',
          title: 'First',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          currentUrl: '',
          type: 'learning-journey',
        },
        {
          id: 'tab-1',
          title: 'Impostor reusing the same ID',
          baseUrl: 'https://grafana.com/docs/grafana/latest/other/',
          currentUrl: '',
          type: 'learning-journey',
        },
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      expect(tabs.map((t) => t.id)).toEqual(['recommendations', 'devtools', 'editor', 'tab-1']);
      expect(tabs.map((t) => t.title)).toEqual(['Recommendations', 'Dev Tools', 'First guide', 'First']);
    });

    it('should reject tabs with invalid base URL', async () => {
      const persistedTabs: PersistedTabData[] = [
        {
          id: 'tab-1',
          title: 'Malicious Tab',
          baseUrl: 'javascript:alert(1)',
          currentUrl: '',
          type: 'learning-journey',
        },
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      // Should only have recommendations tab (malicious tab rejected)
      expect(tabs).toHaveLength(1);
      expect(tabs[0]!.id).toBe('recommendations');
    });

    it('should reject tabs with invalid current URL', async () => {
      const persistedTabs: PersistedTabData[] = [
        {
          id: 'tab-1',
          title: 'Test Tab',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          currentUrl: 'javascript:alert(1)',
          type: 'learning-journey',
        },
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      // Should only have recommendations tab (malicious current URL rejected)
      expect(tabs).toHaveLength(1);
      expect(tabs[0]!.id).toBe('recommendations');
    });

    it('should allow localhost URLs in dev mode', async () => {
      const persistedTabs: PersistedTabData[] = [
        {
          id: 'tab-1',
          title: 'Local Test',
          baseUrl: 'http://localhost:3000/test',
          currentUrl: 'http://localhost:3000/test/page1',
          type: 'learning-journey',
        },
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: true });

      expect(tabs).toHaveLength(2); // recommendations + localhost tab
      expect(tabs[1]!.baseUrl).toBe('http://localhost:3000/test');
    });

    it('should reject localhost URLs when dev mode is disabled', async () => {
      const persistedTabs: PersistedTabData[] = [
        {
          id: 'tab-1',
          title: 'Local Test',
          baseUrl: 'http://localhost:3000/test',
          currentUrl: '',
          type: 'learning-journey',
        },
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      // Should only have recommendations tab (localhost rejected)
      expect(tabs).toHaveLength(1);
      expect(tabs[0]!.id).toBe('recommendations');
    });

    it('should restore multiple valid tabs', async () => {
      const persistedTabs: PersistedTabData[] = [
        {
          id: 'tab-1',
          title: 'Journey 1',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test1/',
          currentUrl: '',
          type: 'learning-journey',
        },
        {
          id: 'tab-2',
          title: 'Journey 2',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test2/',
          currentUrl: '',
          type: 'learning-journey',
        },
        {
          id: 'devtools',
          title: 'Dev Tools',
          baseUrl: '',
          currentUrl: '',
          type: 'devtools',
        },
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      expect(tabs).toHaveLength(4); // recommendations + 3 restored tabs
    });

    it('should handle storage errors gracefully', async () => {
      const storage: TabStorage = {
        getTabs: jest.fn().mockRejectedValue(new Error('Storage error')),
        setTabs: jest.fn(),
        getActiveTab: jest.fn(),
        setActiveTab: jest.fn(),
        clear: jest.fn(),
      };

      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      // Should return default recommendations tab on error
      expect(tabs).toHaveLength(1);
      expect(tabs[0]!.id).toBe('recommendations');
    });

    it('should use baseUrl as currentUrl when currentUrl is missing', async () => {
      const persistedTabs: PersistedTabData[] = [
        {
          id: 'tab-1',
          title: 'Test',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          currentUrl: '',
          type: 'learning-journey',
        },
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      expect(tabs[1]!.currentUrl).toBe('https://grafana.com/docs/grafana/latest/test/');
    });

    it('should default to learning-journey type when type is missing', async () => {
      const persistedTabs: PersistedTabData[] = [
        {
          id: 'tab-1',
          title: 'Test',
          baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
          currentUrl: '',
          // type is missing
        } as PersistedTabData,
      ];

      const storage = createMockTabStorage(persistedTabs);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      expect(tabs[1]!.type).toBe('learning-journey');
    });
  });

  describe('restoreActiveTabFromStorage', () => {
    it('should return recommendations when no active tab is stored', async () => {
      const storage = createMockTabStorage(null, null);
      const tabs = [
        {
          id: 'recommendations',
          type: 'recommendations' as const,
          title: 'Recommendations',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
        },
      ];

      const activeTabId = await restoreActiveTabFromStorage(storage, tabs);
      expect(activeTabId).toBe('recommendations');
    });

    it('should restore valid active tab ID', async () => {
      const storage = createMockTabStorage(null, 'tab-1');
      const tabs = [
        {
          id: 'recommendations',
          type: 'recommendations' as const,
          title: 'Recommendations',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
        },
        {
          id: 'tab-1',
          title: 'Test',
          baseUrl: 'https://grafana.com/test',
          currentUrl: 'https://grafana.com/test',
          content: null,
          isLoading: false,
          error: null,
          type: 'learning-journey' as const,
        },
      ];

      const activeTabId = await restoreActiveTabFromStorage(storage, tabs);
      expect(activeTabId).toBe('tab-1');
    });

    it('should restore devtools as active tab if it exists', async () => {
      const storage = createMockTabStorage(null, 'devtools');
      const tabs = [
        {
          id: 'recommendations',
          type: 'recommendations' as const,
          title: 'Recommendations',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
        },
        {
          id: 'devtools',
          title: 'Dev Tools',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
          type: 'devtools' as const,
        },
      ];

      const activeTabId = await restoreActiveTabFromStorage(storage, tabs);
      expect(activeTabId).toBe('devtools');
    });

    it('should default to recommendations when stored active tab does not exist', async () => {
      const storage = createMockTabStorage(null, 'tab-missing');
      const tabs = [
        {
          id: 'recommendations',
          type: 'recommendations' as const,
          title: 'Recommendations',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
        },
      ];

      const activeTabId = await restoreActiveTabFromStorage(storage, tabs);
      expect(activeTabId).toBe('recommendations');
    });

    it('should handle storage errors gracefully', async () => {
      const storage: TabStorage = {
        getTabs: jest.fn(),
        setTabs: jest.fn(),
        getActiveTab: jest.fn().mockRejectedValue(new Error('Storage error')),
        setActiveTab: jest.fn(),
        clear: jest.fn(),
      };
      const tabs = [
        {
          id: 'recommendations',
          type: 'recommendations' as const,
          title: 'Recommendations',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
        },
      ];

      const activeTabId = await restoreActiveTabFromStorage(storage, tabs);
      expect(activeTabId).toBe('recommendations');
    });
  });

  describe('mergeRestoredTabsWithExisting', () => {
    const blank = (overrides: Partial<LearningJourneyTab> = {}): LearningJourneyTab => ({
      id: 'tab-1',
      type: 'docs',
      title: 'From storage',
      baseUrl: 'https://grafana.com/docs/a/',
      currentUrl: 'https://grafana.com/docs/a/page/',
      content: null,
      isLoading: false,
      error: null,
      ...overrides,
    });

    it('returns restored tabs unchanged when nothing is loaded in memory', () => {
      const restored = [blank()];
      expect(mergeRestoredTabsWithExisting(restored, [])).toBe(restored);
      expect(mergeRestoredTabsWithExisting(restored, [blank({ title: 'Old' })])).toEqual(restored);
    });

    it('keeps content and pathContext when id and currentUrl match', () => {
      const content: RawContent = {
        content: '# guide',
        metadata: { title: 'guide' },
        type: 'single-doc',
        url: 'https://grafana.com/docs/a/page/',
        lastFetched: '2026-01-01T00:00:00.000Z',
      };
      const pathContext: PathContext = {
        learningJourney: {
          currentMilestone: 1,
          totalMilestones: 1,
          baseUrl: 'https://grafana.com/docs/a/',
          milestones: [
            {
              number: 1,
              title: 'Page',
              url: 'https://grafana.com/docs/a/page/',
              isActive: true,
            },
          ],
        },
      };
      const pendingAlignment: PendingAlignment = {
        startingLocation: '/old',
        currentPath: '/old',
        launchSource: 'test',
        decidedAt: 0,
      };
      const existing = [
        blank({
          title: 'Old title',
          content,
          pathContext,
          pendingAlignment,
          error: 'stale',
          isLoading: true,
        }),
      ];
      const restored = [blank({ title: 'Renamed elsewhere' })];

      const merged = mergeRestoredTabsWithExisting(restored, existing);

      expect(merged[0]).toMatchObject({
        title: 'Renamed elsewhere',
        content,
        pathContext,
        isLoading: false,
        error: null,
      });
      expect(merged[0]!.pendingAlignment).toBeUndefined();
    });

    it('does not keep error or pendingAlignment without content', () => {
      const existing = [
        blank({
          error: 'load failed',
          pendingAlignment: {
            startingLocation: '/x',
            currentPath: '/x',
            launchSource: 'test',
            decidedAt: 0,
          },
        }),
      ];
      const restored = [blank()];

      expect(mergeRestoredTabsWithExisting(restored, existing)[0]).toEqual(restored[0]);
    });

    it('does not keep content when currentUrl diverged', () => {
      const existing = [
        blank({
          content: {
            content: '# old page',
            metadata: { title: 'old' },
            type: 'single-doc',
            url: 'https://grafana.com/docs/a/page/',
            lastFetched: '2026-01-01T00:00:00.000Z',
          },
          currentUrl: 'https://grafana.com/docs/a/page/',
        }),
      ];
      const restored = [blank({ currentUrl: 'https://grafana.com/docs/a/other/' })];

      expect(mergeRestoredTabsWithExisting(restored, existing)[0]!.content).toBeNull();
      expect(mergeRestoredTabsWithExisting(restored, existing)[0]!.currentUrl).toBe(
        'https://grafana.com/docs/a/other/'
      );
    });
  });
});
