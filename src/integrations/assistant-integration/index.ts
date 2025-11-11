/**
 * Assistant Integration Module
 *
 * Provides utilities and components for integrating Grafana Assistant
 * with Pathfinder documentation to enable text selection and contextual queries.
 */

export { useTextSelection } from './useTextSelection.hook';
export type { TextSelectionState, SelectionPosition } from './useTextSelection.hook';

export { AssistantSelectionPopover } from './AssistantSelectionPopover';

export { buildAssistantPrompt, buildDocumentContext, isValidSelection } from './assistant-context.utils';

export { getIsAssistantAvailable, getOpenAssistant } from './assistant-dev-mode';
