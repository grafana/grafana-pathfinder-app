import { getConfigWithDefaults, type DocsPluginConfig } from '../constants';
import { isDevModeEnabled } from './dev-mode';
import { getFeatureFlagValue } from './openfeature';

export const CODA_TERMINAL_FLAG = 'pathfinder.coda-terminal';

// Read once per page load: callers evaluate this in render bodies, and every
// evaluation re-fires the tracking hook.
let flagForced: boolean | undefined;

export function isCodaTerminalForcedByFlag(): boolean {
  if (flagForced === undefined) {
    flagForced = getFeatureFlagValue(CODA_TERMINAL_FLAG, false);
  }
  return flagForced;
}

export function resetCodaTerminalFlagCache(): void {
  flagForced = undefined;
}

/**
 * The one enablement gate every Coda caller shares, so the block-level verdict
 * and the `TerminalPanel` mount cannot disagree. Says nothing about the Coda app
 * plugin being installed — that probe is deliberately gated behind this.
 */
export function isCodaTerminalEnabled(pluginConfig: DocsPluginConfig, currentUserId?: number): boolean {
  return (
    isCodaTerminalForcedByFlag() ||
    (isDevModeEnabled(pluginConfig, currentUserId) && getConfigWithDefaults(pluginConfig).enableCodaTerminal)
  );
}
