/**
 * AssistantBlockWrapper
 *
 * A wrapper component that adds assistant-customization functionality
 * to any child content. Unlike AssistantCustomizable which renders its own
 * content, this renders children and overlays the customize button.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Button } from '@grafana/ui';
import {
  useInlineAssistant,
  createAssistantContextItem,
  useProvidePageContext,
  type ChatContextItem,
} from '@grafana/assistant';
import { getDataSourceSrv, locationService } from '@grafana/runtime';
import { getIsAssistantAvailable, useMockInlineAssistant } from './assistant-dev-mode';
import { isAssistantDevModeEnabledGlobal } from '../../components/wysiwyg-editor/dev-mode';
import { reportAppInteraction, UserInteraction, buildAssistantCustomizableProperties } from '../../lib/analytics';
import { createDatasourceMetadataTool, type DatasourceMetadataArtifact, isSupportedDatasourceType } from './tools';

export interface AssistantBlockWrapperProps {
  /** Unique ID for this assistant element */
  assistantId: string;
  /** Type of content (query, config, etc.) */
  assistantType: string;
  /** Default value extracted from the wrapped block */
  defaultValue: string;
  /** Type of block being wrapped */
  blockType: string;
  /** Current content URL for localStorage key */
  contentKey: string;
  /** Child content to render */
  children: React.ReactNode;
}

// REACT: Stable array reference to prevent context thrashing (R3)
const EMPTY_CONTEXT_DEPS: ChatContextItem[] = [];

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    position: 'relative',
    display: 'block',
  }),
  wrapperDefault: css({
    borderLeft: '3px dotted rgb(143, 67, 179)', // Purple to match assistant button
    paddingLeft: theme.spacing(2),
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
    '&:hover': {
      borderLeftColor: 'rgb(163, 87, 199)', // Lighter purple on hover
    },
  }),
  wrapperCustomized: css({
    borderLeft: `3px solid ${theme.colors.success.border}`, // Green for customized
    paddingLeft: theme.spacing(2),
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
    '&:hover': {
      borderLeftColor: theme.colors.success.main,
    },
  }),
  buttonContainer: css({
    position: 'absolute',
    top: '-48px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: theme.zIndex.portal,
    pointerEvents: 'auto',
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap',
  }),
  assistantButtonWrapper: css({
    position: 'relative',
    display: 'inline-block',
    borderRadius: theme.shape.radius.default,
    padding: '2px',
    background: 'linear-gradient(90deg, rgb(204, 51, 204) 0%, rgb(82, 82, 255) 100%)',
    boxShadow: '0 0 12px rgba(143, 67, 179, 0.4)',
    '& button': {
      border: 'none !important',
      background: `${theme.colors.background.primary} !important`,
      margin: 0,
    },
  }),
});

/**
 * Assistant Block Wrapper Component
 *
 * Wraps child content with assistant customization functionality.
 * Shows customize button on hover, stores customizations in localStorage.
 */
export function AssistantBlockWrapper({
  assistantId,
  assistantType,
  defaultValue,
  blockType,
  contentKey,
  children,
}: AssistantBlockWrapperProps) {
  const styles = useStyles2(getStyles);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Check if dev mode is enabled
  const devModeEnabled = isAssistantDevModeEnabledGlobal();

  // Use the inline assistant hook for generating customized content
  const realInlineAssistant = useInlineAssistant();
  const mockInlineAssistant = useMockInlineAssistant();
  const { generate, isGenerating, reset } = devModeEnabled ? mockInlineAssistant : realInlineAssistant;

  // Generate localStorage key
  const getStorageKey = useCallback((): string => {
    return `pathfinder-assistant-${contentKey}-${assistantId}`;
  }, [contentKey, assistantId]);

  // Check if content has been customized
  const getInitialCustomizedState = useCallback(() => {
    try {
      const storageKey = `pathfinder-assistant-${contentKey}-${assistantId}`;
      const storedValue = localStorage.getItem(storageKey);
      return storedValue !== null;
    } catch (error) {
      return false;
    }
  }, [contentKey, assistantId]);

  // State management
  const [isCustomized, setIsCustomized] = useState(getInitialCustomizedState);
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isAssistantAvailable, setIsAssistantAvailable] = useState(false);

  // Provide page context for datasource
  const setPageContext = useProvidePageContext('/explore', EMPTY_CONTEXT_DEPS);

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

  // State to store datasource metadata artifact from tool
  const [metadataArtifact, setMetadataArtifact] = useState<DatasourceMetadataArtifact | null>(null);

  // REACT: memoize tool creation to prevent recreation on each render (R3)
  const datasourceMetadataTool = useMemo(
    () => createDatasourceMetadataTool((artifact) => setMetadataArtifact(artifact)),
    []
  );

  // Get datasource context for assistant
  const getDatasourceContext = useCallback(async () => {
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
      console.warn('[AssistantBlockWrapper] Failed to fetch datasources:', error);
      return { dataSources: [], currentDatasource: null };
    }
  }, [setPageContext]);

  // Build analytics context
  const getAnalyticsContext = useCallback(() => {
    return { assistantId, assistantType, contentKey, inline: false };
  }, [assistantId, assistantType, contentKey]);

  // Handle customize button click
  const handleCustomize = useCallback(async () => {
    const dsContext = await getDatasourceContext();

    if (!dsContext.currentDatasource) {
      console.error('[AssistantBlockWrapper] No datasource available');
      return;
    }

    const datasourceType = dsContext.currentDatasource.type;
    const hasSupportedDatasource = isSupportedDatasourceType(datasourceType);

    // Track customize button click
    reportAppInteraction(
      UserInteraction.AssistantCustomizeClick,
      buildAssistantCustomizableProperties(getAnalyticsContext(), {
        datasource_type: datasourceType,
        block_type: blockType,
      })
    );

    const tools = hasSupportedDatasource ? [datasourceMetadataTool] : [];

    const prompt = hasSupportedDatasource
      ? `Customize this ${assistantType} (${blockType} block) using real data from my ${datasourceType} datasource.

Original content:
${defaultValue}

First, use the fetch_datasource_metadata tool to discover what labels, metrics, services, or other data is available in my datasource.
Then adapt the content to use actual values that exist in my environment.
Keep the same pattern and purpose as the original.

Return only the customized content text.`
      : `Customize this ${assistantType} (${blockType} block) for a ${datasourceType} datasource using realistic values.

Original content:
${defaultValue}

Adapt this to use common ${datasourceType} values that typically exist. Keep the same pattern and purpose.

Return only the customized content text.`;

    const systemPrompt = hasSupportedDatasource
      ? `You are a Grafana ${datasourceType} expert.

When customizing content:
1. ALWAYS use the fetch_datasource_metadata tool first to discover available data
2. Use the actual values (labels, metrics, services, tags, etc.) returned by the tool
3. Keep the original pattern and structure
4. Select values that make semantic sense for the content's purpose

Output only the customized content - no markdown, no explanation, no code blocks.`
      : `You are a Grafana ${datasourceType} expert.

Customize content to use realistic, commonly-available values for ${datasourceType}.

Output only the content - no markdown, no explanation.`;

    // Generate with inline assistant
    await generate({
      prompt,
      origin: 'grafana-pathfinder-app/assistant-block-wrapper',
      systemPrompt,
      tools,
      onComplete: (text) => {
        // Clean up the response (remove markdown code blocks if present)
        let customized = text.trim();
        customized = customized.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
        customized = customized.trim();

        if (customized && customized !== defaultValue) {
          // Save to localStorage
          try {
            const storageKey = getStorageKey();
            localStorage.setItem(storageKey, customized);
            setIsCustomized(true);
            setIsPinned(false);

            // Track successful customization
            const labelCount = metadataArtifact?.metadata.labels
              ? Object.keys(metadataArtifact.metadata.labels).length
              : 0;

            reportAppInteraction(
              UserInteraction.AssistantCustomizeSuccess,
              buildAssistantCustomizableProperties(getAnalyticsContext(), {
                datasource_type: datasourceType,
                block_type: blockType,
                original_length: defaultValue.length,
                customized_length: customized.length,
                used_real_metadata: hasSupportedDatasource && metadataArtifact !== null,
                available_labels_count: labelCount,
              })
            );
          } catch (error) {
            console.warn('[AssistantBlockWrapper] Failed to save to localStorage:', error);
          }
        }
      },
      onError: (err) => {
        console.error('[AssistantBlockWrapper] Generation failed:', err);

        reportAppInteraction(
          UserInteraction.AssistantCustomizeError,
          buildAssistantCustomizableProperties(getAnalyticsContext(), {
            datasource_type: datasourceType,
            block_type: blockType,
            error_message: err instanceof Error ? err.message : 'Unknown error',
          })
        );
      },
    });
  }, [
    assistantType,
    blockType,
    defaultValue,
    generate,
    getStorageKey,
    getDatasourceContext,
    getAnalyticsContext,
    datasourceMetadataTool,
    metadataArtifact,
  ]);

  // Handle revert button click
  const handleRevert = useCallback(() => {
    try {
      const storageKey = getStorageKey();
      localStorage.removeItem(storageKey);
      setIsCustomized(false);
      setIsPinned(false);
      reset();

      reportAppInteraction(
        UserInteraction.AssistantRevertClick,
        buildAssistantCustomizableProperties(getAnalyticsContext(), {
          block_type: blockType,
        })
      );
    } catch (error) {
      console.warn('[AssistantBlockWrapper] Failed to revert:', error);
    }
  }, [getStorageKey, reset, getAnalyticsContext, blockType]);

  // Mouse handlers
  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isPinned) {
      setIsHovered(false);
    }
  }, [isPinned]);

  const handleClick = useCallback(() => {
    setIsPinned((prev) => !prev);
  }, []);

  // Click outside handler to close the button
  useEffect(() => {
    if (!isPinned) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsPinned(false);
        setIsHovered(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    // REACT: cleanup event listener (R1)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPinned]);

  // Show button if hovered OR pinned, and assistant is available
  const showButton = (isHovered || isPinned) && isAssistantAvailable;

  // Render button
  const renderButton = () => {
    if (!showButton && !isGenerating) {
      return null;
    }

    return (
      <div
        className={styles.buttonContainer}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className={styles.buttonGroup}>
          {isGenerating ? (
            <div className={styles.assistantButtonWrapper}>
              <Button icon="fa fa-spinner" size="sm" variant="primary" disabled>
                Generating...
              </Button>
            </div>
          ) : isCustomized ? (
            <Button icon="history-alt" size="sm" variant="primary" fill="solid" onClick={handleRevert}>
              Revert to original
            </Button>
          ) : (
            <div className={styles.assistantButtonWrapper}>
              <Button icon="ai" size="sm" variant="primary" onClick={handleCustomize}>
                Customize
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={wrapperRef}
      className={`${styles.wrapper} ${isCustomized ? styles.wrapperCustomized : styles.wrapperDefault}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      title={isCustomized ? 'Customized by Assistant (click to revert)' : 'Click to customize with Assistant'}
    >
      {children}
      {renderButton()}
    </div>
  );
}
