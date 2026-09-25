import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import * as ts from 'typescript';
import { render, screen } from '@testing-library/react';
import { getConfigWithDefaults } from '../constants';
import { resolvePathfinderAvailability } from './pathfinder-enablement';

// Wrap the compiled entrypoint to execute its top-level awaits under Jest's CommonJS runtime.
const compiled = ts.transpileModule(readFileSync(join(__dirname, '../module.tsx'), 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
}).outputText;

async function boot(remote: boolean, tenant?: boolean, readFailed = false) {
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
    './lib/logging': { logger: { exception: jest.fn(), error: jest.fn(), warn: jest.fn() } },
    './plugin.json': { id: 'grafana-pathfinder-app' },
    './utils/configured-bootstrap': effects,
    './hooks/usePathfinderPluginConfig': {
      refreshPathfinderPluginConfig: async () => settings,
      waitForPathfinderPluginConfig: async () => settings,
    },
    './utils/pathfinder-enablement': { resolvePathfinderAvailability },
    './docs-retrieval/content-fetcher/package-resolver-registry': effects,
    './lib/event-names': { PANEL_MODE_CHANGE_EVENT: 'test-panel-mode-change' },
    './global-state/link-interception': { linkInterceptionState: { setInterceptionEnabled: jest.fn() } },
    'global-state/sidebar': { sidebarState: { setPendingOpenSource: jest.fn() } },
    './global-state/panel-mode': { panelModeManager: { getMode: () => 'floating' } },
    './global-state/suggestion': { suggestionState: {} },
    './utils/pathfinder-deep-link-handler': effects,
    './utils/pathfinder-search-params': {
      parsePathfinderDeepLink: () => ({ doc: 'bundled:test' }),
      parseControllerPairingHash: () => null,
    },
    './lib/storage/extension-sidebar': { ...effects, isExtensionSidebarOwnedByPathfinder: () => true },
    './lib/telemetry/surface': {},
    './utils/openfeature': {
      initializeOpenFeature: async () => {},
      getFeatureFlagValue: (key: string) => key === 'pathfinder.enabled' && remote,
    },
    './utils/experiments/active-experiments': { getActiveExperiments: jest.fn() },
    './utils/experiments': {
      ...effects,
      createExperimentDebugger: jest.fn(),
      initializeHighlightedGuideExperiment: () => ({}),
    },
    './utils/sidebar-auto-open': { getCurrentPath: () => '/', attemptAutoOpen: jest.fn() },
    './completion-records/completion-write-hook': effects,
    './components/floating-panel/FloatingPanelManager': { FloatingPanelManager: () => null },
    './lib/create-root-compat': { createCompatRoot: async () => ({ render: jest.fn() }) },
    './components/App/App': { default: () => <div>Learning app</div>, __esModule: true },
    './components/App/PathfinderUnavailable': {
      PathfinderUnavailable: ({ unavailable }: { unavailable: boolean }) => (
        <div>{unavailable ? 'Unavailable' : 'Disabled'}</div>
      ),
    },
  };
  const requireModule = jest.fn((name: string) => {
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
  [true, undefined, true],
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
  expect(await screen.findByText(readFailed ? 'Unavailable' : 'Disabled')).toBeInTheDocument();
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
  expect(effects.handlePathfinderDeepLink).toHaveBeenCalledWith(expect.objectContaining({ shouldMountSidebar: true }));
});
