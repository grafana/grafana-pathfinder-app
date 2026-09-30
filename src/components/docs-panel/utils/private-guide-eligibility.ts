import type { LearningJourneyTab } from '../../../types/content-panel.types';
import { parseUrlSafely } from '../../../security/url-validator';

function isPublicGuideUrl(value: string): boolean {
  if (value.startsWith('bundled:')) {
    return value !== 'bundled:wysiwyg-preview' && value !== 'bundled:e2e-test';
  }
  const url = parseUrlSafely(value);
  return Boolean(
    url &&
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    !/\/(learning-journeys|learning-paths|tutorials|milestone-\d+)(\/|$)/.test(url.pathname)
  );
}

export function canCopyPublicGuide(tab: LearningJourneyTab | null | undefined, isAdmin: boolean): boolean {
  if (!isAdmin || !tab || tab.isLoading || tab.error || !tab.content?.isNativeJson) {
    return false;
  }
  if (
    (tab.type !== 'docs' && tab.type !== 'interactive') ||
    tab.pathContext ||
    tab.content.type === 'learning-journey' ||
    tab.content.metadata.learningJourney ||
    tab.packageInfo?.resolvedMilestones?.length
  ) {
    return false;
  }
  const manifests = [tab.packageInfo?.packageManifest, tab.content.metadata.packageManifest];
  if (
    manifests.some(
      (manifest) =>
        (manifest?.type !== undefined && manifest.type !== 'guide') ||
        manifest?.milestones !== undefined ||
        manifest?.repository === 'app-platform'
    ) ||
    tab.packageInfo?.repository === 'app-platform' ||
    tab.content.metadata.repository === 'app-platform'
  ) {
    return false;
  }
  return [tab.baseUrl, tab.currentUrl, tab.content.url].every(isPublicGuideUrl);
}
