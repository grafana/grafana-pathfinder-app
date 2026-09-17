import type { ResolvedPathfinderConfig } from '../constants';

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
  if (!config) {
    return;
  }
  effects.applySettings(config);
  if (!context.pathfinderEnabled) {
    return;
  }
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
    if (config.enableKioskMode) {
      effects.mountKiosk(config);
    }
    effects.setupAutoOpen(config);
  }
}
