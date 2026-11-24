import { getFeatureFlagValue } from './openfeature';

export const GUIDE_TRANSLATIONS_FLAG = 'pathfinder.guide-translations';

let enabled: boolean | undefined;

export function isGuideTranslationsEnabled(): boolean {
  if (enabled === undefined) {
    enabled = getFeatureFlagValue(GUIDE_TRANSLATIONS_FLAG, false);
  }
  return enabled;
}

export function resetGuideTranslationsFlagCache(): void {
  enabled = undefined;
}
