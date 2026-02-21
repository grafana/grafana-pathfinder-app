export { SelectorDebugPanel, type SelectorDebugPanelProps } from './SelectorDebugPanel';
export { getDebugPanelStyles } from './debug-panel.styles';

// Re-export utilities for convenience
export { generateBestSelector, getSelectorInfo } from '../../lib/dom';
export { detectActionType, shouldCaptureElement, getActionDescription } from '../../lib/dom/action-detector';
