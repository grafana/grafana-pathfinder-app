/**
 * Unit tests for tab storage restore module
 */

import {
  restoreTabsFromStorage,
  restoreActiveTabFromStorage,
  createUrlValidator,
  TabStorage,
} from './tab-storage-restore';
import { PersistedTabData } from '../../../types/content-panel.types';

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
      expect(tabs[0].id).toBe('recommendations');
    });

    it('should return recommendations tab when storage returns empty array', async () => {
      const storage = createMockTabStorage([]);
      const tabs = await restoreTabsFromStorage(storage, { isDevMode: false });

      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe('recommendations');
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
      expect(tabs[0].id).toBe('recommendations');
      expect(tabs[1].id).toBe('tab-1');
      expect(tabs[1].title).toBe('Test Journey');
      expect(tabs[1].baseUrl).toBe('https://grafana.com/docs/grafana/latest/test/');
      expect(tabs[1].currentUrl).toBe('https://grafana.com/docs/grafana/latest/test/page1/');
      expect(tabs[1].type).toBe('learning-journey');
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
      expect(tabs[1].id).toBe('devtools');
      expect(tabs[1].type).toBe('devtools');
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
      expect(tabs[0].id).toBe('recommendations');
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
      expect(tabs[0].id).toBe('recommendations');
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
      expect(tabs[1].baseUrl).toBe('http://localhost:3000/test');
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
      expect(tabs[0].id).toBe('recommendations');
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
      expect(tabs[0].id).toBe('recommendations');
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

      expect(tabs[1].currentUrl).toBe('https://grafana.com/docs/grafana/latest/test/');
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

      expect(tabs[1].type).toBe('learning-journey');
    });
  });

  describe('restoreActiveTabFromStorage', () => {
    it('should return recommendations when no active tab is stored', async () => {
      const storage = createMockTabStorage(null, null);
      const tabs = [
        {
          id: 'recommendations',
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
          title: 'Recommendations',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
          type: undefined,
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
          title: 'Recommendations',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
          type: undefined,
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
});
