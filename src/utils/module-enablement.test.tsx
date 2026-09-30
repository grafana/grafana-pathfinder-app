import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import * as ts from 'typescript';
import { render, screen, waitFor } from '@testing-library/react';
import { getConfigWithDefaults } from '../constants';
import { resolvePathfinderAvailability } from './pathfinder-enablement';
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
  failedImports: Record<string, number> = {}
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
    '@grafana/i18n': { initPluginTranslations: async () => {} },
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
    './global-state/link-interception': { linkInterceptionState: { setInterceptionEnabled: jest.fn() } },
    'global-state/sidebar': { sidebarState: effects },
    './global-state/panel-mode': { panelModeManager: { getMode: () => panelMode } },
    './global-state/suggestion': { suggestionState: {} },
    './utils/pathfinder-deep-link-handler': effects,
    './utils/pathfinder-search-params': {
      parsePathfinderDeepLink: () => ({ doc: 'bundled:test' }),
      parseControllerPairingHash: () => null,
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
      initializeOpenFeature: async () => {},
      getFeatureFlagValue: (key: string) =>
        key === 'pathfinder.enabled'
          ? remote
          : key === 'pathfinder.frontend-telemetry' && surfaceReported !== undefined,
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
    './lib/create-root-compat': { createCompatRoot: async () => ({ render: jest.fn() }) },
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
