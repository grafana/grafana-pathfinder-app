import type { LearningJourneyTab } from '../../../types/content-panel.types';
import { createControllerPairingLaunch, type ControllerPairingLaunch } from '../../../lib/pairing-manager';
import { buildControllerPairingHash } from '../../../utils/pathfinder-search-params';

export interface ControllerTabOpenAction {
  shouldShow: boolean;
  createControllerUrl?: () => string;
}

export function buildControllerTabUrl(url: string, launch: ControllerPairingLaunch): string {
  const params = new URLSearchParams();
  params.set('doc', url);
  params.set('controller', '1');
  return `/?${params.toString()}#${buildControllerPairingHash(launch)}`;
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
