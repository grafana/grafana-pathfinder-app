import type { ResolvedPathfinderConfig } from '../constants';

import type { HighlightedGuideConfig } from './openfeature.types';

interface ExposureMarker {
  key: string;
  flag: string;
  variant: string;
}

interface PathfinderExperimentDebugger {
  config: HighlightedGuideConfig;
  variant: HighlightedGuideConfig['variant'];
  loadedAt: string;
  bannerVariant: () => string;
  flags: string[];
  setOverride: (flagName: string, value: unknown) => void;
  removeOverride: (flagName: string) => void;
  clearOverrides: () => void;
  showOverrides: () => Record<string, unknown>;
  showExposures: () => ExposureMarker[];
  clearExposures: () => { cleared: number };
}

declare global {
  interface Window {
    __DocsPluginActiveTabUrl?: string;
    __DocsPluginActiveTabId?: string;
    __DocsPluginContentKey?: string;
    __DocsPluginTotalSteps?: number;
    __DocsPluginCurrentStepIndex?: number;
    __pathfinderPluginConfig?: ResolvedPathfinderConfig;
    __pathfinderKioskConfig?: { rulesUrl: string };
    __pathfinderKioskSessionId?: string;
    __pathfinderExperiment?: PathfinderExperimentDebugger;
    __pathfinderAutoOpenUnlisten?: () => void;
    __pathfinderDeepLinkNavUnlisten?: () => void;
    __pathfinderHighlightedGuideNavUnlisten?: () => void;
  }
}

export {};
