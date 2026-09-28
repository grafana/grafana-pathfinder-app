// Entry-safe seam for docs-retrieval to reach learning-paths' badge/streak
// orchestration without a lateral Tier 2 -> Tier 2 import. learning-paths
// registers its implementation here on load (see its barrel); until then
// every wrapper degrades to a safe default and logs, since that only happens
// on a real bootstrap-ordering bug.
import type { LearningPath } from '../types/learning-paths.types';
import { logger } from './logging';

export interface GuideCompletionBridge {
  markGuideCompleted: (guideId: string) => Promise<void>;
  findPathByUrl: (url: string) => LearningPath | undefined;
}

let bridge: GuideCompletionBridge | null = null;

export function registerGuideCompletionBridge(impl: GuideCompletionBridge): void {
  bridge = impl;
}

function warnUnregistered(fn: string): void {
  logger.warn(`guide-completion-bridge.${fn} called before learning-paths registered its implementation`);
}

export async function markGuideCompleted(guideId: string): Promise<void> {
  if (!bridge) {
    warnUnregistered('markGuideCompleted');
    return;
  }
  return bridge.markGuideCompleted(guideId);
}

export function findPathByUrl(url: string): LearningPath | undefined {
  if (!bridge) {
    warnUnregistered('findPathByUrl');
    return undefined;
  }
  return bridge.findPathByUrl(url);
}
