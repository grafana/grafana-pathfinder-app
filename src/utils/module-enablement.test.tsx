import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import * as ts from 'typescript';
import { render, screen, waitFor } from '@testing-library/react';
import { getConfigWithDefaults } from '../constants';
import { resolvePathfinderAvailability } from './pathfinder-enablement';
import type { DeepLinkParams } from './pathfinder-search-params';
import { createTranslatedComponent } from '../components/App/TranslatedComponent';

jest.mock('../lib/plugin-translations', () => ({
  loadTranslatedModule: async (load: () => Promise<unknown>) => load(),
}));

import { retryChunkImport } from '../lib/retry-chunk-import';

// Wrap the compiled entrypoint to execute its top-level awaits under Jest's CommonJS runtime.
const compiled = ts.transpileModule(readFileSync(join(__dirname, '../module.tsx'), 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
}).outputText;

async function boot(
  remote: boolean,
  tenant?: boolean,
  readFailed = false,
  read?: Promise<ReturnType<typeof getConfigWithDefaults>>,
  dockedPlugin = 'grafana-pathfinder-app',
  surfaceReported?: boolean,
  panelMode = 'floating',
  failedImports: Record<string, number> = {},
  flags: Record<string, boolean> = {},
  deepLink: DeepLinkParams = { doc: 'bundled:test' },
  translationReady: Promise<void> = Promise.resolve(),
  controllerPairing: object | null = null
) {
  const settings = readFailed ? undefined : getConfigWithDefaults({ pathfinderEnabled: tenant });
  const root = { component: undefined as React.ComponentType | undefined };
  const plugin = {
    init: () => {},
    setRootPage: jest.fn(function (this: unknown, component: React.ComponentType) {
      root.component = component;
      return this;
    }),
    addConfigPage: jest.fn().mockReturnThis(),
    addComponent: jest.fn().mockReturnThis(),
    addLink: jest.fn().mockReturnThis(),
  };
  const effects = {
    initializeConfiguredSurfaces: jest.fn().mockResolvedValue(undefined),
    handlePathfinderDeepLink: jest.fn(),
    installDeepLinkNavListener: jest.fn(),
    setPackageResolverFactory: jest.fn(),
    setupHighlightedGuideAutoOpen: jest.fn(),
    armCompletionWriteHook: jest.fn(),
    clearExtensionSidebarDocked: jest.fn(),
    setPendingOpenSource: jest.fn(),
    recordStartupSettings: jest.fn(),
    onPathfinderSurfaceChange: jest.fn().mockReturnValue(jest.fn()),
    setInterceptionEnabled: jest.fn(),
    ensurePluginTranslations: jest.fn().mockReturnValue(translationReady),
    initializeOpenFeature: jest.fn().mockResolvedValue(undefined),
    createCompatRoot: jest.fn(async () => ({ render: jest.fn() })),
    installLiveTabExecutor: jest.fn(),
    reportPathfinderSurface: jest.fn(),
    reportPathfinderSurfaceClosed: jest.fn(),
  };
  const modules: Record<string, unknown> = {
    react: React,
    '@grafana/data': {
      AppPlugin: function () {
        return plugin;
      },
      PluginExtensionPoints: { CommandPalette: 'command-palette' },
    },
    '@grafana/ui': { LoadingPlaceholder: () => null },
    './components/App/TranslatedComponent': { createTranslatedComponent },
    './lib/plugin-translations': {
      ensurePluginTranslations: effects.ensurePluginTranslations,
      loadTranslatedModule: async (load: () => Promise<unknown>) => {
        await translationReady;
        return load();
      },
    },
    './lib/analytics': { reportAppInteraction: jest.fn(), UserInteraction: {}, bindExperimentsProvider: jest.fn() },
    './lib/retry-chunk-import': { retryChunkImport },
    './lib/logging': { logger: { exception: jest.fn(), error: jest.fn(), warn: jest.fn() } },
    './plugin.json': { id: 'grafana-pathfinder-app' },
    './utils/configured-bootstrap': effects,
    './hooks/usePathfinderPluginConfig': {
      readPathfinderStartupPreference: async () => (read ? await read : settings),
      waitForPathfinderPluginConfig: async () => (read ? await read : settings),
    },
    './utils/pathfinder-enablement': {
      resolvePathfinderAvailability,
      getPathfinderStartupDecision: () => ({ durationMs: 10, outcome: 'resolved' }),
    },
    './docs-retrieval/content-fetcher/package-resolver-registry': effects,
    './lib/event-names': { PANEL_MODE_CHANGE_EVENT: 'test-panel-mode-change' },
    './global-state/link-interception': { linkInterceptionState: effects },
    'global-state/sidebar': { sidebarState: effects },
    './global-state/panel-mode': { panelModeManager: { getMode: () => panelMode } },
    './global-state/suggestion': { suggestionState: {} },
    './utils/pathfinder-deep-link-handler': effects,
    './utils/pathfinder-search-params': {
      parsePathfinderDeepLink: () => deepLink,
      parseControllerPairingHash: () => controllerPairing,
    },
    './lib/storage/extension-sidebar': {
      ...effects,
      parseExtensionSidebarDocked: () => ({ pluginId: dockedPlugin }),
      isExtensionSidebarOwnedByPathfinder: () => !dockedPlugin || dockedPlugin === 'grafana-pathfinder-app',
    },
    './lib/telemetry/surface': {
      ...effects,
      hasReportedPathfinderSurface: () => surfaceReported,
      isPathfinderOpen: () => true,
    },
    './lib/faro': { initFaro: async () => {}, resolveSessionReplayOptions: jest.fn() },
    './lib/telemetry/facade': effects,
    './lib/telemetry/session': { stampSessionExperiments: jest.fn() },
    './utils/openfeature': {
      initializeOpenFeature: effects.initializeOpenFeature,
      getFeatureFlagValue: (key: string) =>
        key === 'pathfinder.enabled'
          ? remote
          : (flags[key] ?? (key === 'pathfinder.frontend-telemetry' && surfaceReported !== undefined)),
      getNumberFlagValue: () => 1,
    },
    './utils/experiments/active-experiments': { getActiveExperiments: jest.fn() },
    './utils/experiments': {
      ...effects,
      createExperimentDebugger: jest.fn(),
      subscribeToEnrollment: jest.fn(),
      initializeHighlightedGuideExperiment: () => ({}),
    },
    './utils/sidebar-auto-open': { getCurrentPath: () => '/', attemptAutoOpen: jest.fn() },
    './completion-records/completion-write-hook': effects,
    './components/floating-panel/FloatingPanelManager': { FloatingPanelManager: () => null },
    './lib/create-root-compat': effects,
    './components/kiosk/KioskOverlay': { KioskOverlay: () => null },
    './integrations/cross-tab/live-tab-executor': effects,
    './integrations/cross-tab/PairingRequestBanner': { PairingRequestBanner: () => null },
    './components/App/App': { default: () => <div>Learning app</div>, __esModule: true },
    './components/App/PathfinderDisabled': {
      PathfinderDisabled: () => <div>Disabled</div>,
    },
  };
  const requireModule = jest.fn((name: string) => {
    const remainingFailures = failedImports[name] ?? 0;
    if (remainingFailures > 0) {
      failedImports[name] = remainingFailures - 1;
      throw Object.assign(new Error('Loading chunk failed'), { name: 'ChunkLoadError' });
    }
    if (!(name in modules)) {
      throw new Error(`Unexpected import: ${name}`);
    }
    return modules[name];
  });
  const exports = {};
  const execute = runInNewContext(`(async (require, exports) => { ${compiled}\n })`, { window, document, CustomEvent });
  await execute(requireModule, exports);
  return { plugin, effects, root, requireModule };
}

it.each([
  [true, false, false],
  [false, true, false],
  [false, false, false],
])('suppresses every entry point with remote=%s, tenant=%s, read failure=%s', async (remote, tenant, readFailed) => {
  const { plugin, effects, root, requireModule } = await boot(remote, tenant, readFailed);
  plugin.init();
  expect(plugin.addComponent).not.toHaveBeenCalled();
  expect(plugin.addLink).not.toHaveBeenCalled();
  expect(plugin.addConfigPage).toHaveBeenCalledTimes(3);
  expect(effects.clearExtensionSidebarDocked).toHaveBeenCalled();
  expect(effects.initializeConfiguredSurfaces).not.toHaveBeenCalled();
  expect(effects.handlePathfinderDeepLink).not.toHaveBeenCalled();
  expect(effects.installDeepLinkNavListener).not.toHaveBeenCalled();
  expect(effects.setPackageResolverFactory).not.toHaveBeenCalled();
  expect(effects.setupHighlightedGuideAutoOpen).not.toHaveBeenCalled();
  const Root = root.component!;
  render(<Root />);
  expect(await screen.findByText('Disabled')).toBeInTheDocument();
  expect(requireModule.mock.calls.flat()).not.toContain('./components/App/App');
  expect(requireModule.mock.calls.flat()).not.toContain('./components/floating-panel/FloatingPanelManager');
  expect(requireModule.mock.calls.flat()).not.toContain('./components/ControlGroupDocPopup');
});

it.each([true, undefined])('registers learning surfaces when remote enabled and tenant=%s', async (tenant) => {
  const { plugin, effects } = await boot(true, tenant);
  expect(plugin.addComponent).toHaveBeenCalledTimes(1);
  expect(plugin.addLink).toHaveBeenCalledTimes(4);
  plugin.init();
  expect(effects.initializeConfiguredSurfaces).toHaveBeenCalledTimes(1);
  expect(effects.handlePathfinderDeepLink).toHaveBeenCalledWith(
    expect.objectContaining({ attemptAutoOpen: expect.any(Function) })
  );
});

it('registers baseline learning surfaces after an unsuccessful settings read', async () => {
  const { plugin } = await boot(true, undefined, true);
  expect(plugin.addComponent).toHaveBeenCalledTimes(1);
  expect(plugin.addLink).toHaveBeenCalledTimes(4);
  expect(plugin.addConfigPage).toHaveBeenCalledTimes(3);
});

it('keeps the page-load decision after timeout, while late opt-out reaches configured bootstrap', async () => {
  jest.useFakeTimers();
  try {
    let finish!: (config: ReturnType<typeof getConfigWithDefaults>) => void;
    const read = new Promise<ReturnType<typeof getConfigWithDefaults>>((resolve) => {
      finish = resolve;
    });
    const startup = boot(true, undefined, false, read);
    await jest.advanceTimersByTimeAsync(3000);
    const { plugin, effects, root } = await startup;
    expect(plugin.addComponent).toHaveBeenCalledTimes(1);
    plugin.init();
    finish(getConfigWithDefaults({ pathfinderEnabled: false }));
    await expect(effects.initializeConfiguredSurfaces.mock.calls[0][0]).resolves.toMatchObject({
      pathfinderEnabled: false,
    });
    const Root = root.component!;
    render(<Root />);
    await jest.advanceTimersByTimeAsync(0);
    expect(await screen.findByText('Learning app')).toBeInTheDocument();
    expect(plugin.addComponent).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it.each([
  [false, false, false],
  [false, true, true],
  [true, false, true],
])('intercepts docs links with flag=%s and tenant setting=%s: %s', async (flag, setting, expected) => {
  const { plugin, effects } = await boot(true, true, false, undefined, undefined, undefined, undefined, undefined, {
    'pathfinder.intercept-docs-links': flag,
  });
  plugin.init();

  const [, , surfaceEffects] = effects.initializeConfiguredSurfaces.mock.calls[0];
  surfaceEffects.applySettings(getConfigWithDefaults({ interceptGlobalDocsLinks: setting }));

  expect(effects.setInterceptionEnabled).toHaveBeenCalledWith(expected);
});

it('does not clear another plugin’s docked entry', async () => {
  const { effects } = await boot(false, false, false, undefined, 'another-plugin');
  expect(effects.clearExtensionSidebarDocked).not.toHaveBeenCalled();
});

it('rejects buffered and subsequent suggestions while disabled', async () => {
  const detail = { suggestions: [] as unknown[], status: '', reason: '' };
  const startup = boot(false);
  document.dispatchEvent(new CustomEvent('pathfinder-suggest', { detail }));
  await startup;
  expect(detail).toMatchObject({ status: 'rejected', reason: 'pathfinder_disabled' });
  const later = { suggestions: [] };
  document.dispatchEvent(new CustomEvent('pathfinder-suggest', { detail: later }));
  expect(later).toMatchObject({ status: 'rejected', reason: 'pathfinder_disabled' });
});

it('clears a legacy title-only dock when disabled', async () => {
  const { effects } = await boot(false, false, false, undefined, '');
  expect(effects.clearExtensionSidebarDocked).toHaveBeenCalledTimes(1);
});

it('waits for a reported mount before recording startup telemetry for a restored surface', async () => {
  const { effects } = await boot(true, true, false, undefined, 'grafana-pathfinder-app', false);
  await Promise.resolve();
  expect(effects.recordStartupSettings).not.toHaveBeenCalled();
  await waitFor(() => expect(effects.onPathfinderSurfaceChange).toHaveBeenCalled());
  const onSurface = effects.onPathfinderSurfaceChange.mock.calls[0][0];
  onSurface('closed');
  expect(effects.recordStartupSettings).not.toHaveBeenCalled();
  onSurface('floating');
  expect(effects.recordStartupSettings).toHaveBeenCalledWith(10, 'resolved');
  expect(effects.onPathfinderSurfaceChange.mock.results[0]!.value).toHaveBeenCalledTimes(1);
});

it('records immediately when the surface has already reported its mount', async () => {
  const { effects } = await boot(true, true, false, undefined, 'grafana-pathfinder-app', true);
  await Promise.resolve();
  await waitFor(() => expect(effects.recordStartupSettings).toHaveBeenCalledWith(10, 'resolved'));
  expect(effects.onPathfinderSurfaceChange).not.toHaveBeenCalled();
});

it('restores a legacy title-only dock when enabled in sidebar mode', async () => {
  const { effects } = await boot(true, true, false, undefined, '', undefined, 'sidebar');
  expect(effects.setPendingOpenSource).toHaveBeenCalledWith('browser_restore', 'restore');
  expect(effects.clearExtensionSidebarDocked).not.toHaveBeenCalled();
});

it('registers the plugin while Faro chunks retry and later recovers telemetry', async () => {
  jest.useFakeTimers();
  try {
    const { plugin, effects } = await boot(true, true, false, undefined, 'grafana-pathfinder-app', true, 'floating', {
      './lib/faro': 1,
    });
    expect(plugin.setRootPage).toHaveBeenCalled();
    expect(effects.recordStartupSettings).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(effects.recordStartupSettings).toHaveBeenCalledWith(10, 'resolved');
  } finally {
    jest.useRealTimers();
  }
});

it('recovers the completion subscriber without delaying synchronous navigation setup', async () => {
  jest.useFakeTimers();
  try {
    const { plugin, effects } = await boot(
      true,
      true,
      false,
      undefined,
      'grafana-pathfinder-app',
      undefined,
      'floating',
      {
        './completion-records/completion-write-hook': 1,
      }
    );
    plugin.init();
    expect(effects.installDeepLinkNavListener).toHaveBeenCalled();
    expect(effects.armCompletionWriteHook).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(effects.armCompletionWriteHook).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('releases a failed floating mount claim and allows a later activation to recover', async () => {
  jest.useFakeTimers();
  document.getElementById('pathfinder-floating-root')?.remove();
  try {
    const { plugin, effects } = await boot(true, true, false, undefined, undefined, undefined, 'floating', {
      './lib/create-root-compat': 4,
    });
    plugin.init();
    plugin.init();
    expect(document.querySelectorAll('#pathfinder-floating-root')).toHaveLength(1);
    expect(effects.installDeepLinkNavListener).toHaveBeenCalled();
    await jest.runAllTimersAsync();
    expect(document.getElementById('pathfinder-floating-root')).toBeNull();
    plugin.init();
    await jest.runAllTimersAsync();
    expect(effects.createCompatRoot).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('#pathfinder-floating-root')).toHaveLength(1);
  } finally {
    document.getElementById('pathfinder-floating-root')?.remove();
    jest.useRealTimers();
  }
});

it.each<DeepLinkParams>([
  {},
  { pathfinderKiosk: true, doc: 'bundled:test' },
  { pathfinderKiosk: true, controller: true },
])('does not preload translations without an unambiguous kiosk launch: %j', async (link) => {
  const { effects } = await boot(true, true, false, undefined, undefined, undefined, 'sidebar', {}, {}, link);
  expect(effects.ensurePluginTranslations).not.toHaveBeenCalled();
});

it('starts kiosk translations before asynchronous bootstrap without waiting for them', async () => {
  const { effects } = await boot(
    true,
    true,
    false,
    undefined,
    undefined,
    undefined,
    'sidebar',
    {},
    {},
    { pathfinderKiosk: true },
    new Promise<void>(() => {})
  );
  expect(effects.ensurePluginTranslations).toHaveBeenCalledTimes(1);
  expect(effects.ensurePluginTranslations.mock.invocationCallOrder[0]).toBeLessThan(
    effects.initializeOpenFeature.mock.invocationCallOrder[0]!
  );
});

it('removes the controller mount and closes its surface when root creation fails', async () => {
  const { plugin, effects } = await boot(
    true,
    true,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    {},
    { doc: 'bundled:test', controller: true },
    Promise.resolve(),
    {}
  );
  effects.createCompatRoot.mockRejectedValueOnce(new Error('root unavailable'));
  plugin.init();
  effects.initializeConfiguredSurfaces.mock.calls[0][2].mountController();
  await waitFor(() => expect(effects.reportPathfinderSurfaceClosed).toHaveBeenCalledWith('controller'));
  expect(document.getElementById('pathfinder-controller-root')).toBeNull();
});

it('installs the live-tab executor while translations are unavailable', async () => {
  const { plugin, effects } = await boot(
    true,
    true,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    {},
    { doc: 'bundled:test' },
    new Promise<void>(() => {})
  );
  plugin.init();
  effects.initializeConfiguredSurfaces.mock.calls[0][2].mountExecutor();
  await waitFor(() => expect(effects.installLiveTabExecutor).toHaveBeenCalledTimes(1));
  document.getElementById('pathfinder-pairing-banner-root')?.remove();
});

it('preloads kiosk UI only after translation readiness without mounting a surface', async () => {
  let ready!: () => void;
  const translations = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const { requireModule, effects } = await boot(
    true,
    true,
    false,
    undefined,
    undefined,
    undefined,
    'sidebar',
    {},
    {},
    { pathfinderKiosk: true },
    translations
  );
  expect(requireModule).not.toHaveBeenCalledWith('./components/kiosk/KioskOverlay');
  ready();
  await waitFor(() => expect(requireModule).toHaveBeenCalledWith('./components/kiosk/KioskOverlay'));
  expect(effects.createCompatRoot).not.toHaveBeenCalled();
});

it.each([{ doc: 'bundled:test' }, { doc: 'bundled:test', controller: true }])(
  'does not preload the kiosk overlay for a document or controller link: %j',
  async (deepLink) => {
    const { requireModule } = await boot(
      true,
      true,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      {},
      deepLink
    );
    expect(requireModule).not.toHaveBeenCalledWith('./components/kiosk/KioskOverlay');
  }
);

it('allows URL kiosk preloading before enablement without mounting a disabled surface', async () => {
  const { plugin, requireModule, effects } = await boot(
    false,
    false,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    {},
    { pathfinderKiosk: true }
  );
  await waitFor(() => expect(requireModule).toHaveBeenCalledWith('./components/kiosk/KioskOverlay'));
  plugin.init();
  expect(effects.initializeConfiguredSurfaces).not.toHaveBeenCalled();
  expect(effects.createCompatRoot).not.toHaveBeenCalled();
});
