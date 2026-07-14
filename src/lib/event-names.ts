export const StorageEvents = {
  LearningProgressUpdated: 'learning-progress-updated',
  GuideResponseChanged: 'guide-response-changed',
  InteractiveProgressCleared: 'interactive-progress-cleared',
} as const;

export type StorageEventName = (typeof StorageEvents)[keyof typeof StorageEvents];

export const PANEL_MODE_CHANGE_EVENT = 'pathfinder-panel-mode-change';

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
