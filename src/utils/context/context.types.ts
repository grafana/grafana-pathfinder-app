// All context-related interfaces in one place
export interface DataSource {
  id: number;
  name: string;
  type: string;
  url?: string;
  isDefault?: boolean;
  access?: string;
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
  type?: string; // 'learning-journey' or 'docs-page'
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
  tags: string[];
  isLoading: boolean;
  recommendationsError: string | null;
  visualizationType: string | null;
  grafanaVersion: string;
  theme: string;
  timestamp: string;
  searchParams: Record<string, string>;
}

export interface ContextPayload {
  path: string;
  datasources: string[];
  tags: string[];
  user_id: string;
  user_role: string;
  platform: string;
}

export interface RecommenderResponse {
  recommendations: Recommendation[];
}

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
