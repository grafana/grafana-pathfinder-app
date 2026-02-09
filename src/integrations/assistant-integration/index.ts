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
 *
 * Version 0.1.7+ includes:
 * - Custom tools for inline assistant (createTool, InlineToolRunnable)
 * - Unified datasource metadata tool (Prometheus, Loki, Tempo, Pyroscope)
 * - Grafana context tool for environment information
 */

export { useTextSelection } from './useTextSelection.hook';
export type { TextSelectionState, SelectionPosition } from '../../types/hooks.types';

export { AssistantSelectionPopover } from './AssistantSelectionPopover';

export { AssistantCustomizable } from './AssistantCustomizable';
export type { AssistantCustomizableProps } from './AssistantCustomizable';

export { AssistantBlockWrapper } from './AssistantBlockWrapper';
export type { AssistantBlockWrapperProps } from './AssistantBlockWrapper';

export { AssistantCustomizableProvider, useAssistantCustomizableContext } from './AssistantCustomizableContext';
export type { AssistantCustomizableContextValue } from './AssistantCustomizableContext';

export { AssistantBlockValueProvider, useAssistantBlockValue } from './AssistantBlockValueContext';
export type { AssistantBlockValueContextValue } from './AssistantBlockValueContext';

export { buildAssistantPrompt, buildDocumentContext, isValidSelection } from './assistant-context.utils';

// Shared assistant generation hook and utilities
export {
  useAssistantGeneration,
  cleanAssistantResponse,
  extractQueryFromResponse,
  buildQuerySystemPrompt,
  buildContentSystemPrompt,
} from './useAssistantGeneration.hook';
export type {
  UseAssistantGenerationOptions,
  UseAssistantGenerationReturn,
  DatasourceContext,
} from './useAssistantGeneration.hook';

export {
  getIsAssistantAvailable,
  getOpenAssistant,
  useMockInlineAssistant,
} from './assistant-dev-mode';

// Custom tools for inline assistant
export {
  // Tools
  createDatasourceMetadataTool,
  datasourceMetadataTool,
  createGrafanaContextTool,
  grafanaContextTool,
  // Datasource utils (for advanced use cases)
  fetchPrometheusMetadata,
  fetchLokiMetadata,
  fetchTempoMetadata,
  fetchPyroscopeMetadata,
  // Type utilities
  isSupportedDatasourceType,
  getNormalizedDatasourceType,
  filterSupportedDatasources,
  DATASOURCE_TYPE_MAP,
} from './tools';

export type {
  DatasourceInfo,
  MetricsMetadata,
  TracingMetadata,
  ProfilingMetadata,
  DatasourceMetadata,
  DatasourceMetadataArtifact,
  GrafanaContextArtifact,
  SupportedDatasourceType,
} from './tools';

// Re-export new @grafana/assistant v0.1.5+ components for convenience
export { OpenAssistantButton, OpenAssistantSplitButton, AITextInput, AITextArea } from '@grafana/assistant';

export type {
  OpenAssistantButtonProps,
  OpenAssistantSplitButtonProps,
  AITextInputProps,
  AITextAreaProps,
} from '@grafana/assistant';

// Re-export tool types from @grafana/assistant v0.1.7+ for custom tool creation
export { createTool } from '@grafana/assistant';
export type { InlineToolRunnable, ToolInvokeOptions, ToolOutput } from '@grafana/assistant';
