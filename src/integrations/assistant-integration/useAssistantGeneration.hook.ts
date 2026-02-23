/**
 * Shared Hook for Assistant Generation
 *
 * Extracts common functionality used by both AssistantBlockWrapper and AssistantCustomizable:
 * - Assistant availability checking
 * - Datasource context fetching
 * - Tool creation with callback handling
 * - Prompt building helpers
 *
 * @module useAssistantGeneration
 */

import { useState, useEffect, useCallback } from 'react';
import {
  useInlineAssistant,
  useProvidePageContext,
  createAssistantContextItem,
  type ChatContextItem,
} from '@grafana/assistant';
import { getDataSourceSrv, locationService } from '@grafana/runtime';
import { getIsAssistantAvailable, useMockInlineAssistant } from './assistant-dev-mode';
import { isAssistantDevModeEnabledGlobal } from '../../utils/dev-mode';
import { createDatasourceMetadataTool, type DatasourceMetadataArtifact, isSupportedDatasourceType } from './tools';

// REACT: Stable array reference to prevent context thrashing (R3)
const EMPTY_CONTEXT_DEPS: ChatContextItem[] = [];

export interface DatasourceContext {
  dataSources: Array<{ name: string; type: string; uid: string }>;
  currentDatasource: { name: string; type: string; uid: string } | null;
}

export interface UseAssistantGenerationOptions {
  /** Current content URL for localStorage key */
  contentKey: string;
  /** Unique ID for this assistant element */
  assistantId: string;
}

export interface UseAssistantGenerationReturn {
  /** Whether the assistant is available in this Grafana instance */
  isAssistantAvailable: boolean;
  /** The inline assistant generate function */
  generate: ReturnType<typeof useInlineAssistant>['generate'];
  /** Whether content is currently being generated */
  isGenerating: boolean;
  /** Generated content (streaming) */
  content: string | null;
  /** Reset assistant state */
  reset: () => void;
  /** Get datasource context for customization */
  getDatasourceContext: () => Promise<DatasourceContext>;
  /** Whether the current datasource is supported for metadata fetching */
  isSupportedDatasource: (type: string) => boolean;
  /** Create a datasource metadata tool with callback */
  createMetadataTool: (
    onArtifact: (artifact: DatasourceMetadataArtifact) => void
  ) => ReturnType<typeof createDatasourceMetadataTool>;
  /** Build the storage key for localStorage */
  getStorageKey: () => string;
}

/**
 * Shared hook for assistant generation functionality.
 *
 * Extracts common patterns from AssistantBlockWrapper and AssistantCustomizable
 * to reduce code duplication.
 *
 * @example
 * ```tsx
 * const {
 *   isAssistantAvailable,
 *   generate,
 *   isGenerating,
 *   getDatasourceContext,
 *   createMetadataTool,
 * } = useAssistantGeneration({ contentKey, assistantId });
 * ```
 */
export function useAssistantGeneration(options: UseAssistantGenerationOptions): UseAssistantGenerationReturn {
  const { contentKey, assistantId } = options;

  // Check if dev mode is enabled
  const devModeEnabled = isAssistantDevModeEnabledGlobal();

  // Use the inline assistant hook for generating customized content
  const realInlineAssistant = useInlineAssistant();
  const mockInlineAssistant = useMockInlineAssistant();
  const { generate, isGenerating, content, reset } = devModeEnabled ? mockInlineAssistant : realInlineAssistant;

  // Track assistant availability
  const [isAssistantAvailable, setIsAssistantAvailable] = useState(false);

  // Provide page context for datasource
  const setPageContext = useProvidePageContext('/explore', EMPTY_CONTEXT_DEPS);

  // Generate localStorage key
  const getStorageKey = useCallback((): string => {
    return `pathfinder-assistant-${contentKey}-${assistantId}`;
  }, [contentKey, assistantId]);

  // Check if assistant is available
  useEffect(() => {
    const subscription = getIsAssistantAvailable().subscribe((available: boolean) => {
      setIsAssistantAvailable(available);
    });

    // REACT: cleanup subscription (R1)
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Get datasource context for assistant and provide it via page context
  const getDatasourceContext = useCallback(async (): Promise<DatasourceContext> => {
    try {
      const dataSourceSrv = getDataSourceSrv();
      const dataSources = await dataSourceSrv.getList();

      // Get current datasource from URL if in Explore
      const location = locationService.getLocation();
      let currentDatasource = null;

      if (location.pathname.includes('/explore')) {
        const searchParams = locationService.getSearchObject();
        const leftPaneState = searchParams.left ? JSON.parse(searchParams.left as string) : null;
        const datasourceName = leftPaneState?.datasource;

        if (datasourceName) {
          currentDatasource = dataSources.find((ds) => ds.name === datasourceName || ds.uid === datasourceName);
        }
      }

      // Fallback: get first Prometheus datasource if no current one
      if (!currentDatasource) {
        currentDatasource = dataSources.find((ds) => ds.type === 'prometheus');
      }

      // Provide datasource context to assistant using page context
      if (currentDatasource && setPageContext) {
        const datasourceContext = createAssistantContextItem('datasource', {
          datasourceUid: currentDatasource.uid,
        });
        setPageContext([datasourceContext]);
      }

      return {
        dataSources: dataSources.map((ds) => ({ name: ds.name, type: ds.type, uid: ds.uid })),
        currentDatasource: currentDatasource
          ? {
              name: currentDatasource.name,
              type: currentDatasource.type,
              uid: currentDatasource.uid,
            }
          : null,
      };
    } catch (error) {
      console.warn('[useAssistantGeneration] Failed to fetch datasources:', error);
      return { dataSources: [], currentDatasource: null };
    }
  }, [setPageContext]);

  // Create metadata tool factory
  const createMetadataTool = useCallback((onArtifact: (artifact: DatasourceMetadataArtifact) => void) => {
    return createDatasourceMetadataTool(onArtifact);
  }, []);

  return {
    isAssistantAvailable,
    generate,
    isGenerating,
    content,
    reset,
    getDatasourceContext,
    isSupportedDatasource: isSupportedDatasourceType,
    createMetadataTool,
    getStorageKey,
  };
}

/**
 * Clean up assistant response by removing markdown code blocks.
 *
 * @param text - Raw response text from assistant
 * @returns Cleaned text without code block markers
 */
export function cleanAssistantResponse(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
  return cleaned.trim();
}

/**
 * Extract query from assistant response using QUERY: marker.
 *
 * @param text - Response text (potentially cleaned)
 * @returns Extracted query or original text if no marker found
 */
export function extractQueryFromResponse(text: string): string {
  const queryMatch = text.match(/QUERY:\s*(.+?)$/ms);
  if (queryMatch) {
    let query = queryMatch[1]!.trim();
    // Strip any surrounding backticks
    query = query.replace(/^`+|`+$/g, '');
    return query;
  }
  return text;
}

/**
 * Build a system prompt for query customization.
 *
 * @param datasourceType - Type of datasource (prometheus, loki, tempo, pyroscope)
 * @param hasSupportedDatasource - Whether the datasource supports metadata fetching
 * @returns System prompt string
 */
export function buildQuerySystemPrompt(datasourceType: string, hasSupportedDatasource: boolean): string {
  // Base prompt for all datasource types
  const basePrompt = `You are a Grafana ${datasourceType} expert.

RULES:
1. ${hasSupportedDatasource ? 'Use the fetch_datasource_metadata tool to discover available data' : 'Use realistic commonly-available values'}
2. Keep the EXACT same query structure and functions as the original
3. Only replace metric names, label names, or label values with real ones`;

  // Datasource-specific guidance
  const datasourceGuidance: Record<string, string> = {
    prometheus: `
METRIC SELECTION PRIORITY (for Prometheus):
- PREFER standard base metrics (ending in _total, _count, _seconds, _bytes, _sum, _bucket)
- PREFER metrics without colons (recording rules like "job:metric:rate5m" are custom and less educational)
- PREFER shorter, simpler metric names over complex nested ones
- PREFER well-known metrics like: up, process_cpu_seconds_total, http_requests_total, node_cpu_seconds_total
- If no matching base metric exists, then use a recording rule`,
    loki: `
LOG SELECTION PRIORITY (for Loki):
- PREFER labels that identify applications: app, service, namespace, job
- PREFER common log levels: level, severity
- Use realistic stream selectors that would exist in most environments`,
    tempo: `
TRACE SELECTION PRIORITY (for Tempo):
- PREFER service names that represent real applications
- PREFER standard span attributes: service.name, http.method, http.status_code
- Use realistic trace IDs and span IDs from the metadata`,
    pyroscope: `
PROFILE SELECTION PRIORITY (for Pyroscope):
- PREFER standard profile types: cpu, memory, goroutine
- PREFER application names that exist in the metadata`,
  };

  const specificGuidance = datasourceGuidance[datasourceType.toLowerCase()] || '';

  return `${basePrompt}
${specificGuidance}

OUTPUT FORMAT: You may explain briefly, but you MUST end with the final query on a line starting with "QUERY:"
Example:
QUERY: sum(rate(http_requests_total[5m]))`;
}

/**
 * Build a system prompt for content customization (non-query blocks).
 *
 * @param datasourceType - Type of datasource
 * @param hasSupportedDatasource - Whether the datasource supports metadata fetching
 * @returns System prompt string
 */
export function buildContentSystemPrompt(datasourceType: string, hasSupportedDatasource: boolean): string {
  if (hasSupportedDatasource) {
    return `You are a Grafana ${datasourceType} expert.

When customizing content:
1. ALWAYS use the fetch_datasource_metadata tool first to discover available data
2. Use the actual values (labels, metrics, services, tags, etc.) returned by the tool
3. Keep the original pattern and structure
4. Select values that make semantic sense for the content's purpose

Output only the customized content - no markdown, no explanation, no code blocks.`;
  }

  return `You are a Grafana ${datasourceType} expert.

Customize content to use realistic, commonly-available values for ${datasourceType}.

Output only the content - no markdown, no explanation.`;
}
