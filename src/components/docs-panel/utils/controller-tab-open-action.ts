import { config } from '@grafana/runtime';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import { createControllerPairingLaunch, type ControllerPairingLaunch } from '../../../lib/pairing-manager';
import { buildControllerPairingHash } from '../../../utils/pathfinder-search-params';

export interface ControllerTabOpenAction {
  shouldShow: boolean;
  createControllerUrl?: () => string;
}

export function buildControllerTabUrl(url: string, launch: ControllerPairingLaunch): string {
  // Older Grafana home redirects discard the pairing fragment before plugin startup.
  const controllerUrl = new URL(`${config.appSubUrl ?? ''}/dashboards`, window.location.origin);
  controllerUrl.searchParams.set('doc', url);
  controllerUrl.searchParams.set('controller', '1');
  controllerUrl.hash = buildControllerPairingHash(launch);
  return controllerUrl.toString();
}

export function pickControllerTabOpenAction(
  url: string | undefined,
  tabType: LearningJourneyTab['type']
): ControllerTabOpenAction {
  if (!url || tabType !== 'interactive') {
    return { shouldShow: false };
  }
  return { shouldShow: true, createControllerUrl: () => buildControllerTabUrl(url, createControllerPairingLaunch()) };
}
