import type { PackageOpenInfo } from './content-panel.types';
import type { LearningPath } from './learning-paths.types';
import type { GuideTargeting } from './package.types';

export interface CatalogPackage {
  key: string;
  id: string;
  title: string;
  description?: string;
  format: 'guide' | 'path';
  source: 'grafana' | 'organization';
  category?: string;
  targeting?: GuideTargeting;
  url: string;
  estimatedMinutes?: number;
  activityCount?: number;
  memberIds?: string[];
  packageInfo?: PackageOpenInfo;
  curatedPath?: LearningPath;
}

export interface CatalogFilters {
  query: string;
  format: 'all' | 'guide' | 'path';
  source: 'all' | 'grafana' | 'organization';
  category: string;
}

export interface CatalogViewState extends CatalogFilters {
  mode: 'explore' | 'all';
  expandedKeys: string[];
  scrollTop: number;
  visibleCount: number;
  focusKey: string | null;
}

export const CATALOG_BATCH_SIZE = 24;

export const EMPTY_CATALOG_VIEW: CatalogViewState = {
  mode: 'explore',
  query: '',
  format: 'all',
  source: 'all',
  category: 'all',
  expandedKeys: [],
  scrollTop: 0,
  visibleCount: CATALOG_BATCH_SIZE,
  focusKey: null,
};
