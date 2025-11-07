export { SelectorDebugPanel, type SelectorDebugPanelProps } from './SelectorDebugPanel';
export { getDebugPanelStyles } from './debug-panel.styles';

// Re-export utilities for convenience
export { generateBestSelector, getSelectorInfo } from '../../utils/selector-generator';
export {
  detectActionType,
  shouldCaptureElement,
  getActionDescription,
} from '../../interactive-engine/auto-completion/action-detector';
