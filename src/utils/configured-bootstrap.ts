import type { ResolvedPathfinderConfig } from '../constants';
import { installKioskNavigation } from './kiosk-navigation';

interface ConfiguredBootstrapContext {
  pathfinderEnabled: boolean;
  controllerRequested: boolean;
  hasDoc: boolean;
}

interface ConfiguredBootstrapEffects {
  applySettings: (config: ResolvedPathfinderConfig) => void;
  mountController: (config: ResolvedPathfinderConfig) => void;
  mountExecutor: (config: ResolvedPathfinderConfig) => void;
  mountKiosk: (config: ResolvedPathfinderConfig) => void;
  setupAutoOpen: (config: ResolvedPathfinderConfig) => void;
}

export async function initializeConfiguredSurfaces(
  settings: Promise<ResolvedPathfinderConfig | undefined>,
  context: ConfiguredBootstrapContext,
  effects: ConfiguredBootstrapEffects
): Promise<void> {
  const config = await settings;
  if (!config || !context.pathfinderEnabled || !config.pathfinderEnabled) {
    return;
  }
  effects.applySettings(config);
  const kioskRequested = installKioskNavigation(() => effects.mountKiosk(config));
  if (context.controllerRequested) {
    if (config.enableTwoTabController) {
      effects.mountController(config);
    }
    return;
  }
  if (config.enableTwoTabController) {
    effects.mountExecutor(config);
  }
  if (!context.hasDoc) {
    if (config.enableKioskMode && !kioskRequested) {
      effects.mountKiosk(config);
    }
    if (!kioskRequested) {
      effects.setupAutoOpen(config);
    }
  }
}
