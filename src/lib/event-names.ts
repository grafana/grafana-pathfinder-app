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

// Dispatched by integrations/coda's TerminalProvider on every connection-status
// change, with detail { status }. `is-terminal-active` and `coda-exit-zero:`
// read live module state, so they can see a connection — but nothing tells them
// to look again when one arrives, and provisioning a VM takes about a minute.
// Consumed by requirements-manager/step-checker.hook.ts.
export const TERMINAL_STATUS_CHANGED_EVENT = 'pathfinder-terminal-status-changed';

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
