/**
 * Pins finding 3: /context must construct the scene model with the config
 * `plugin.init` publishes, not `{}`. Empty config makes isDevModeEnabled read
 * false and prune authorized Dev Tools during restore.
 */

jest.mock('@grafana/scenes', () => ({
  EmbeddedScene: class {
    constructor(public state: unknown) {}
  },
  SceneAppPage: class {
    constructor(opts: { getScene: () => unknown }) {
      (globalThis as any).__docsPageContextScene = opts.getScene;
    }
  },
  SceneFlexItem: class {
    constructor(public state: unknown) {}
  },
  SceneFlexLayout: class {
    constructor(public state: unknown) {}
  },
}));

jest.mock('../components/docs-panel/docs-panel', () => ({
  CombinedLearningJourneyPanel: class {
    constructor(config: unknown) {
      (globalThis as any).__docsPagePanelConfig = config;
    }
  },
}));

jest.mock('../utils/utils.routing', () => ({
  prefixRoute: (path: string) => path,
}));

import './docsPage';

describe('docsPage plugin config', () => {
  const original = (window as any).__pathfinderPluginConfig;

  afterEach(() => {
    (window as any).__pathfinderPluginConfig = original;
    delete (globalThis as any).__docsPagePanelConfig;
  });

  it('constructs the panel with the config published by plugin.init on window', () => {
    (window as any).__pathfinderPluginConfig = {
      devMode: true,
      devModeOptIn: true,
    };

    (globalThis as any).__docsPageContextScene();

    expect((globalThis as any).__docsPagePanelConfig).toEqual(
      expect.objectContaining({
        devMode: true,
        devModeOptIn: true,
      })
    );
  });

  it('defaults safely when the window global is unset (fail closed for Dev Tools)', () => {
    delete (window as any).__pathfinderPluginConfig;

    (globalThis as any).__docsPageContextScene();

    expect((globalThis as any).__docsPagePanelConfig).toEqual(expect.objectContaining({ devMode: false }));
  });
});
