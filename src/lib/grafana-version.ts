import { config } from '@grafana/runtime';

// First Grafana release containing grafana/grafana#126261 (Modal: don't dismiss
// when pressing inside the portal container). Until that PR merges and ships,
// this stays at a sentinel so companion mode is disabled everywhere — the
// floating panel would otherwise dismiss native modals on click.
// TODO(companion): set to the real minimum version once #126261 is released.
const MIN_COMPANION_GRAFANA_VERSION: [number, number, number] = [999, 0, 0];

function parseVersion(version: string | undefined): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * True when the running Grafana includes the modal portal-container dismiss fix,
 * so a floating overlay rendered into getPortalContainer() can coexist with native
 * modals (no outside-press dismiss). Gates companion mode.
 */
export function isModalCoexistenceSupported(): boolean {
  const parsed = parseVersion(config.buildInfo?.version);
  if (!parsed) {
    return false;
  }
  const [major, minor, patch] = parsed;
  const [minMajor, minMinor, minPatch] = MIN_COMPANION_GRAFANA_VERSION;
  if (major !== minMajor) {
    return major > minMajor;
  }
  if (minor !== minMinor) {
    return minor > minMinor;
  }
  return patch >= minPatch;
}
