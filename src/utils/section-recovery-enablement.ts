import { getFeatureFlagValue } from './openfeature';

export const SECTION_RECOVERY_FLAG = 'pathfinder.section-recovery';

let enabled: boolean | undefined;

export function isSectionRecoveryEnabled(): boolean {
  if (enabled === undefined) {
    enabled = getFeatureFlagValue(SECTION_RECOVERY_FLAG, true);
  }
  return enabled;
}

export function resetSectionRecoveryFlagCache(): void {
  enabled = undefined;
}
