import type { ResolvedPathfinderConfig } from '../constants';

interface ExposureMarker {
  key: string;
  flag: string;
  variant: string;
}

interface PathfinderExperimentDebugger {
  loadedAt: string;
  bannerVariant: () => string;
  autoOpenGuide: () => { variant: string; shown: string[] };
  clearAutoOpenGuideMarkers: () => { cleared: number };
  flags: string[];
  showExposures: () => ExposureMarker[];
  clearExposures: () => { cleared: number };
}
export interface PathfinderE2EControlV1 {
  readonly version: 1;
  resetActiveGuide(): Promise<void>;
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
    __pathfinderKioskName?: string;
    __pathfinderExperiment?: PathfinderExperimentDebugger;
    __pathfinderAutoOpenUnlisten?: () => void;
    __pathfinderDeepLinkNavUnlisten?: () => void;
    __pathfinderE2E?: PathfinderE2EControlV1;
  }
}

export {};
