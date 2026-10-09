import { getFeatureFlagValue } from './openfeature';

export const DOCS_LINK_INTERCEPTION_FLAG = 'pathfinder.intercept-docs-links';

// Read once per page load: the config form evaluates this in its render body,
// and every evaluation re-fires the tracking hook.
let flagForced: boolean | undefined;

export function isDocsLinkInterceptionForcedByFlag(): boolean {
  if (flagForced === undefined) {
    flagForced = getFeatureFlagValue(DOCS_LINK_INTERCEPTION_FLAG, false);
  }
  return flagForced;
}

export function resetDocsLinkInterceptionFlagCache(): void {
  flagForced = undefined;
}
