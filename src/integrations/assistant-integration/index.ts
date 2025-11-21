/**
 * Assistant Integration Module
 *
 * Provides utilities and components for integrating Grafana Assistant
 * with Pathfinder documentation to enable text selection, contextual queries,
 * and customizable content elements.
 *
 * Version 0.1.5+ includes:
 * - OpenAssistantSplitButton: Split button with dropdown for additional actions
 * - AITextInput/AITextArea: AI-enhanced input components
 */

export { useTextSelection } from './useTextSelection.hook';
export type { TextSelectionState, SelectionPosition } from '../../types/hooks.types';

export { AssistantSelectionPopover } from './AssistantSelectionPopover';

export { AssistantCustomizable } from './AssistantCustomizable';
export type { AssistantCustomizableProps } from './AssistantCustomizable';

export { AssistantCustomizableProvider, useAssistantCustomizableContext } from './AssistantCustomizableContext';
export type { AssistantCustomizableContextValue } from './AssistantCustomizableContext';

export { buildAssistantPrompt, buildDocumentContext, isValidSelection } from './assistant-context.utils';

export {
  getIsAssistantAvailable,
  getOpenAssistant,
  useMockInlineAssistant,
  getMockInlineAssistantResult,
} from './assistant-dev-mode';

// Re-export new @grafana/assistant v0.1.5+ components for convenience
export { OpenAssistantButton, OpenAssistantSplitButton, AITextInput, AITextArea } from '@grafana/assistant';

export type {
  OpenAssistantButtonProps,
  OpenAssistantSplitButtonProps,
  AITextInputProps,
  AITextAreaProps,
} from '@grafana/assistant';
