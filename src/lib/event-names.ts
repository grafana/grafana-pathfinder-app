export const StorageEvents = {
  LearningProgressUpdated: 'learning-progress-updated',
  GuideResponseChanged: 'guide-response-changed',
  InteractiveProgressCleared: 'interactive-progress-cleared',
} as const;

export type StorageEventName = (typeof StorageEvents)[keyof typeof StorageEvents];

// Dispatched by global-state/panel-mode's panelModeManager.setMode with
// detail { mode, previous }; consumed by every Pathfinder surface.
export const PANEL_MODE_CHANGE_EVENT = 'pathfinder-panel-mode-change';

// Dispatched by launch paths after panelModeManager.setPendingGuide: a
// same-mode transient launch fires no PANEL_MODE_CHANGE_EVENT, so an
// already-mounted floating panel must be signalled to consume directly.
export const REQUEST_FLOATING_GUIDE_EVENT = 'pathfinder-request-floating-guide';

// Dispatched by HomePanel's openFullScreen after panelModeManager.setPendingGuide,
// for the same reason REQUEST_FLOATING_GUIDE_EVENT exists: @grafana/scenes
// caches the full-screen SceneAppPage by pathname only (it ignores the ?doc=
// query string), so the full-screen surface's mount effect — which consumes
// the pending guide — only ever fires once per session. Every launch after
// the first would otherwise navigate to an already-initialized surface with
// nobody listening. Consumed by FullScreenPanel's existing already-mounted
// consume listener (shared with `pathfinder-request-full-screen`).
export const REQUEST_FULLSCREEN_GUIDE_EVENT = 'pathfinder-request-fullscreen-guide';

// Signals that window.__pathfinderPluginConfig has a new value; carries no
// payload, because any script sharing the document can dispatch it. Owned by
// publishPathfinderPluginConfig in hooks/usePathfinderPluginConfig.ts.
export const PATHFINDER_CONFIG_UPDATED_EVENT = 'pathfinder-config-updated';

// Ask the docs panel to open a URL in a new tab. Dispatched by the global
// link interceptor, HomePanel's beside-Grafana launch path, and grot guides;
// handled by useAutoOpenListener. Detail: { url, title, source?, launchKey? }
// — the optional launchKey redeems a prepared launch from guideLaunchStore;
// the payload itself never rides this forgeable event.
export const AUTO_OPEN_DOCS_EVENT = 'pathfinder-auto-open-docs';

export const FloatingPanelEvents = {
  Dodge: 'pathfinder-floating-dodge',
  Compact: 'pathfinder-floating-compact',
  RestorePosition: 'pathfinder-floating-restore-position',
  RestoreFull: 'pathfinder-floating-restore-full',
  ManualMove: 'pathfinder-floating-manual-move',
} as const;

export type FloatingPanelEventName = (typeof FloatingPanelEvents)[keyof typeof FloatingPanelEvents];

export interface FloatingPanelMoveDetail {
  x: number;
  y: number;
}
