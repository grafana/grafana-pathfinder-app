/**
 * Context engine type definitions
 * Types for the context-aware recommendation system
 *
 * Re-exported from src/context-engine/context.types.ts for centralized access
 */

export interface DataSource {
  id: number;
  uid: string;
  name: string;
  type: string;
  url?: string;
  isDefault?: boolean;
  access?: string;
}

export interface Plugin {
  id: string;
  name: string;
  type: string;
  info: {
    description: string;
    version: string;
  };
  enabled: boolean;
  pinned: boolean;
}

export interface DashboardSearchResult {
  id: number;
  uid: string;
  orgId: number;
  title: string;
  uri: string;
  url: string;
  slug: string;
  type: string;
  tags: string[];
  isStarred: boolean;
  sortMeta: number;
  isDeleted: boolean;
}

export interface DashboardInfo {
  id?: number;
  title?: string;
  uid?: string;
  tags?: string[];
  folderId?: number;
  folderTitle?: string;
}

export interface Recommendation {
  title: string;
  url: string;
  type?: 'learning-journey' | 'docs-page' | 'interactive';
  matchAccuracy?: number; // Scale of 0 to 1, where 1 = 100% accurate match
  milestones?: any[]; // Import from docs-fetcher if needed
  totalSteps?: number;
  isLoadingSteps?: boolean;
  stepsExpanded?: boolean;
  summary?: string;
  summaryExpanded?: boolean;
  completionPercentage?: number;
  [key: string]: any;
}

export interface ContextData {
  currentPath: string;
  currentUrl: string;
  pathSegments: string[];
  dataSources: DataSource[];
  dashboardInfo: DashboardInfo | null;
  recommendations: Recommendation[];
  featuredRecommendations: Recommendation[];
  tags: string[];
  isLoading: boolean;
  recommendationsError: string | null;
  recommendationsErrorType: 'unavailable' | 'rate-limit' | 'other' | null;
  usingFallbackRecommendations: boolean;
  visualizationType: string | null;
  grafanaVersion: string;
  theme: string;
  timestamp: string;
  searchParams: Record<string, string>;
  platform: string; // 'oss' or 'cloud'
}

export interface ContextPayload {
  path: string;
  datasources: string[];
  tags: string[];
  user_id: string;
  user_email: string;
  user_role: string;
  platform: string;
  source?: string; // Cloud instance source
  language?: string; // User's preferred language/locale
}

export interface RecommenderResponse {
  recommendations: Recommendation[];
  featured?: Recommendation[];
}

export interface BundledInteractive {
  id: string;
  title: string;
  summary: string;
  filename: string;
  exportName: string;
  url: string | string[]; // Can be single URL or array of URLs
  targetPlatform?: 'oss' | 'cloud'; // Optional: filter by platform (defaults to both if not specified)
}

export interface BundledInteractivesIndex {
  interactives: BundledInteractive[];
}

// Hook types (re-exported from hooks.types.ts for convenience)
export interface UseContextPanelOptions {
  onOpenLearningJourney?: (url: string, title: string) => void;
  onOpenDocsPage?: (url: string, title: string) => void;
}

export interface UseContextPanelReturn {
  contextData: ContextData;
  isLoadingRecommendations: boolean;
  otherDocsExpanded: boolean;

  // Actions
  refreshContext: () => void;
  refreshRecommendations: () => void;
  openLearningJourney: (url: string, title: string) => void;
  openDocsPage: (url: string, title: string) => void;
  toggleSummaryExpansion: (recommendationUrl: string) => void;
  navigateToPath: (path: string) => void;
  toggleOtherDocsExpansion: () => void;
}
