// Entry-safe seam for context-engine to reach docs-retrieval content resolution
// without a lateral Tier 2 -> Tier 2 import. docs-retrieval registers its
// implementation here on load (see its barrel); until then every wrapper
// degrades to a safe default and logs, since that only happens on a real
// bootstrap-ordering bug.
import type { ContentFetchOptions, ContentFetchResult, Milestone } from '../types/content.types';
import type { ResolvedNavLink } from '../types/context.types';
import { logger } from './logging';

export interface LearningJourneyContentBridge {
  fetchContent: (url: string, options?: ContentFetchOptions) => Promise<ContentFetchResult>;
  getJourneyCompletionPercentageAsync: (journeyBaseUrl: string) => Promise<number>;
  resolvePackageMilestones: (milestoneIds: string[], pathSlug?: string) => Promise<Milestone[]>;
  resolvePackageNavLinks: (packageIds: string[]) => Promise<ResolvedNavLink[]>;
  derivePathSlug: (manifestId: string) => string;
}

let bridge: LearningJourneyContentBridge | null = null;

export function registerLearningJourneyContentBridge(impl: LearningJourneyContentBridge): void {
  bridge = impl;
}

function warnUnregistered(fn: string): void {
  logger.warn(`learning-journey-content-bridge.${fn} called before docs-retrieval registered its implementation`);
}

export async function fetchContent(url: string, options?: ContentFetchOptions): Promise<ContentFetchResult> {
  if (!bridge) {
    warnUnregistered('fetchContent');
    return { content: null, error: 'docs-retrieval content bridge not registered', errorType: 'other' };
  }
  return bridge.fetchContent(url, options);
}

export async function getJourneyCompletionPercentageAsync(journeyBaseUrl: string): Promise<number> {
  if (!bridge) {
    warnUnregistered('getJourneyCompletionPercentageAsync');
    return 0;
  }
  return bridge.getJourneyCompletionPercentageAsync(journeyBaseUrl);
}

export async function resolvePackageMilestones(milestoneIds: string[], pathSlug?: string): Promise<Milestone[]> {
  if (!bridge) {
    warnUnregistered('resolvePackageMilestones');
    return [];
  }
  return bridge.resolvePackageMilestones(milestoneIds, pathSlug);
}

export async function resolvePackageNavLinks(packageIds: string[]): Promise<ResolvedNavLink[]> {
  if (!bridge) {
    warnUnregistered('resolvePackageNavLinks');
    return [];
  }
  return bridge.resolvePackageNavLinks(packageIds);
}

export function derivePathSlug(manifestId: string): string {
  if (!bridge) {
    warnUnregistered('derivePathSlug');
    return manifestId;
  }
  return bridge.derivePathSlug(manifestId);
}
