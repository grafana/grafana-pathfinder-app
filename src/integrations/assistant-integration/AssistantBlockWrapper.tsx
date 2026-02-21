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
import { reportAppInteraction, UserInteraction, buildAssistantCustomizableProperties } from '../../lib/analytics';
import { type DatasourceMetadataArtifact } from './tools';
import { AssistantBlockValueProvider } from './AssistantBlockValueContext';
import { parseMarkdownToElements } from '../../docs-retrieval/json-parser';
import type { ParsedElement } from '../../types/content.types';
import { CodeBlock } from '../../docs-retrieval/components/docs';
import {
  useAssistantGeneration,
  cleanAssistantResponse,
  extractQueryFromResponse,
  buildQuerySystemPrompt,
  buildContentSystemPrompt,
} from './useAssistantGeneration.hook';

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
  /** Optional context from surrounding blocks to help assistant understand purpose */
  surroundingContext?: {
    before?: string;
    after?: string;
  };
}

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
  surroundingContext,
}: AssistantBlockWrapperProps) {
  const styles = useStyles2(getStyles);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Use the shared assistant generation hook
  const {
    isAssistantAvailable,
    generate,
    isGenerating,
    content,
    reset,
    getDatasourceContext,
    isSupportedDatasource,
    createMetadataTool,
    getStorageKey,
  } = useAssistantGeneration({ contentKey, assistantId });

  // Track previous isGenerating state to detect completion
  const wasGeneratingRef = useRef(false);

  // Get initial customized value from localStorage
  const getInitialCustomizedValue = useCallback((): string | null => {
    try {
      const storageKey = `pathfinder-assistant-${contentKey}-${assistantId}`;
      return localStorage.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }, [contentKey, assistantId]);

  // State management
  const [customizedValue, setCustomizedValue] = useState<string | null>(getInitialCustomizedValue);
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  // Track datasource type used for customization (for syntax highlighting)
  const [customizedDatasourceType, setCustomizedDatasourceType] = useState<string | null>(null);
  // Track error state for showing error UI
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Derived state: content is customized if we have a customized value
  const isCustomized = customizedValue !== null;

  // Track generation context for workaround (SDK onComplete bug)
  const generationContextRef = useRef<{ datasourceType: string; blockType: string } | null>(null);

  // WORKAROUND: SDK v0.1.8 bug where onComplete is not called when tools are used
  // Detect completion by watching isGenerating transition from true to false
  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current;
    wasGeneratingRef.current = isGenerating;

    // Detect completion: was generating, now not generating, and we have content
    if (wasGenerating && !isGenerating && content && generationContextRef.current) {
      // Clean up the response using shared utility
      let customized = cleanAssistantResponse(content);

      // For query blocks, extract just the query using shared utility
      const ctx = generationContextRef.current;
      const isQueryBlockWorkaround = ctx?.blockType === 'interactive' || ctx?.blockType === 'code';
      if (isQueryBlockWorkaround) {
        customized = extractQueryFromResponse(customized);
      }

      // For query blocks, add @@CLEAR@@ prefix back if original had it
      const needsClearMarker = defaultValue.startsWith('@@CLEAR@@');
      const cleanedDefault = defaultValue.replace(/^@@CLEAR@@\s*/, '');

      if (customized && customized !== cleanedDefault) {
        // Save to localStorage - add @@CLEAR@@ prefix for query blocks
        const valueToSave = needsClearMarker ? `@@CLEAR@@ ${customized}` : customized;
        try {
          const storageKey = getStorageKey();
          localStorage.setItem(storageKey, valueToSave);
          // Intentional: Sync React state with external SDK completion state
          // This is a workaround for SDK v0.1.8 onComplete callback bug
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setCustomizedValue(valueToSave);
          // Track datasource type for syntax highlighting (ctx is captured from outer scope)

          setCustomizedDatasourceType(ctx.datasourceType);

          setIsPinned(false);

          // Track successful customization
          reportAppInteraction(
            UserInteraction.AssistantCustomizeSuccess,
            buildAssistantCustomizableProperties(
              { assistantId, assistantType, contentKey, inline: false },
              {
                datasource_type: ctx.datasourceType,
                block_type: ctx.blockType,
                original_length: defaultValue.length,
                customized_length: customized.length,
                used_workaround: true,
              }
            )
          );
        } catch (error) {
          console.warn('[AssistantBlockWrapper] Failed to save to localStorage:', error);
        }
      }

      // Clear context after handling
      generationContextRef.current = null;
    }
  }, [isGenerating, content, defaultValue, getStorageKey, assistantId, assistantType, contentKey]);

  // State to store datasource metadata artifact from tool
  const [metadataArtifact, setMetadataArtifact] = useState<DatasourceMetadataArtifact | null>(null);

  // REACT: memoize tool creation using shared factory (R3)
  const datasourceMetadataTool = useMemo(
    () => createMetadataTool((artifact) => setMetadataArtifact(artifact)),
    [createMetadataTool]
  );

  // Build analytics context
  const getAnalyticsContext = useCallback(() => {
    return { assistantId, assistantType, contentKey, inline: false };
  }, [assistantId, assistantType, contentKey]);

  // Handle customize button click
  const handleCustomize = useCallback(async () => {
    // Clear any existing error state before starting
    setGenerationError(null);

    const dsContext = await getDatasourceContext();

    if (!dsContext.currentDatasource) {
      console.error('[AssistantBlockWrapper] No datasource available');
      setGenerationError('No datasource available. Please select a datasource first.');
      return;
    }

    const datasourceType = dsContext.currentDatasource.type;
    const hasSupportedDatasource = isSupportedDatasource(datasourceType);

    // Store context for workaround (SDK v0.1.8 onComplete bug)
    generationContextRef.current = { datasourceType, blockType };

    // Track customize button click
    reportAppInteraction(
      UserInteraction.AssistantCustomizeClick,
      buildAssistantCustomizableProperties(getAnalyticsContext(), {
        datasource_type: datasourceType,
        block_type: blockType,
      })
    );

    const tools = hasSupportedDatasource ? [datasourceMetadataTool] : [];

    // Strip @@CLEAR@@ marker from interactive block values for the prompt
    const cleanedDefaultValue = defaultValue.replace(/^@@CLEAR@@\s*/, '');
    const isQueryBlock = blockType === 'interactive' || blockType === 'code';

    // Build context section from surrounding blocks (helps AI understand purpose)
    const contextSection = surroundingContext?.before
      ? `Context: This step demonstrates "${surroundingContext.before}"${
          surroundingContext.after ? ` followed by "${surroundingContext.after}"` : ''
        }\n\n`
      : surroundingContext?.after
        ? `Context: This precedes "${surroundingContext.after}"\n\n`
        : '';

    // Different prompts for query blocks vs content blocks
    const prompt = isQueryBlock
      ? hasSupportedDatasource
        ? `${contextSection}Customize this ${datasourceType} query using real data from my datasource.

Original query:
${cleanedDefaultValue}

First, use the fetch_datasource_metadata tool to discover what labels, metrics, or services exist.
Then adapt the query to use actual values from my environment while keeping the same query pattern.

OUTPUT FORMAT: End your response with the query on its own line prefixed by "QUERY:"
Example: QUERY: sum(rate(http_requests_total[5m]))`
        : `${contextSection}Customize this ${datasourceType} query using realistic values.

Original query:
${cleanedDefaultValue}

Adapt to use common ${datasourceType} values. Keep the same query pattern.

OUTPUT FORMAT: End your response with the query on its own line prefixed by "QUERY:"
Example: QUERY: sum(rate(http_requests_total[5m]))`
      : hasSupportedDatasource
        ? `${contextSection}Customize this ${assistantType} (${blockType} block) using real data from my ${datasourceType} datasource.

Original content:
${cleanedDefaultValue}

First, use the fetch_datasource_metadata tool to discover what labels, metrics, services, or other data is available in my datasource.
Then adapt the content to use actual values that exist in my environment.
Keep the same pattern and purpose as the original.

Return only the customized content text.`
        : `${contextSection}Customize this ${assistantType} (${blockType} block) for a ${datasourceType} datasource using realistic values.

Original content:
${cleanedDefaultValue}

Adapt this to use common ${datasourceType} values that typically exist. Keep the same pattern and purpose.

Return only the customized content text.`;

    // Use shared system prompt builders (fixes Prometheus-specific guidance for other datasources)
    const systemPrompt = isQueryBlock
      ? buildQuerySystemPrompt(datasourceType, hasSupportedDatasource)
      : buildContentSystemPrompt(datasourceType, hasSupportedDatasource);

    // Generate with inline assistant
    await generate({
      prompt,
      origin: 'grafana-pathfinder-app/assistant-block-wrapper',
      systemPrompt,
      tools,
      onComplete: (text) => {
        // Clear workaround context since SDK callback worked
        generationContextRef.current = null;

        // Use shared utilities to clean up the response
        let customized = cleanAssistantResponse(text);

        // For query blocks, extract just the query using shared utility
        const isQueryBlockInCallback = blockType === 'interactive' || blockType === 'code';
        if (isQueryBlockInCallback) {
          customized = extractQueryFromResponse(customized);
        }

        // For query blocks, add @@CLEAR@@ prefix back if original had it
        const needsClearMarker = defaultValue.startsWith('@@CLEAR@@');
        const cleanedDefault = defaultValue.replace(/^@@CLEAR@@\s*/, '');

        if (customized && customized !== cleanedDefault) {
          // Save to localStorage - add @@CLEAR@@ prefix for query blocks
          const valueToSave = needsClearMarker ? `@@CLEAR@@ ${customized}` : customized;
          try {
            const storageKey = getStorageKey();
            localStorage.setItem(storageKey, valueToSave);
            setCustomizedValue(valueToSave);
            setCustomizedDatasourceType(datasourceType);
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

        // Set error state for UI feedback
        const errorMessage = err instanceof Error ? err.message : 'Generation failed. Please try again.';
        setGenerationError(errorMessage);

        reportAppInteraction(
          UserInteraction.AssistantCustomizeError,
          buildAssistantCustomizableProperties(getAnalyticsContext(), {
            datasource_type: datasourceType,
            block_type: blockType,
            error_message: errorMessage,
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
    isSupportedDatasource,
    surroundingContext,
  ]);

  // Handle revert button click
  const handleRevert = useCallback(() => {
    try {
      const storageKey = getStorageKey();
      localStorage.removeItem(storageKey);
      setCustomizedValue(null);
      setCustomizedDatasourceType(null);
      setGenerationError(null);
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
  // Handle dismissing error state
  const handleDismissError = useCallback(() => {
    setGenerationError(null);
  }, []);

  const renderButton = () => {
    // Show button if hovered, pinned, generating, or has error
    if (!showButton && !isGenerating && !generationError) {
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
          {generationError ? (
            // Error state: show error message with retry and dismiss buttons
            <>
              <Button
                icon="exclamation-triangle"
                size="sm"
                variant="destructive"
                fill="solid"
                onClick={handleCustomize}
                title={generationError}
              >
                Retry
              </Button>
              <Button
                icon="times"
                size="sm"
                variant="secondary"
                onClick={handleDismissError}
                title="Dismiss error"
                aria-label="Dismiss error"
              />
            </>
          ) : isGenerating ? (
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

  // Helper to render ParsedElements to React nodes
  // Handles markdown elements produced by parseMarkdownToElements
  const renderParsedElement = (element: ParsedElement | string, key: string | number): React.ReactNode => {
    if (typeof element === 'string') {
      return element;
    }

    const children = element.children?.map((child, i) =>
      typeof child === 'string' ? child : renderParsedElement(child as ParsedElement, `${key}-${i}`)
    );

    switch (element.type) {
      case 'code-block':
        return (
          <CodeBlock
            key={key}
            code={element.props.code}
            language={element.props.language}
            showCopy={element.props.showCopy}
            inline={element.props.inline}
          />
        );
      case 'strong':
        return <strong key={key}>{children}</strong>;
      case 'em':
        return <em key={key}>{children}</em>;
      case 'a':
        return (
          <a key={key} href={element.props.href} target={element.props.target} rel={element.props.rel}>
            {children}
          </a>
        );
      case 'p':
        return <p key={key}>{children}</p>;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        const HeadingTag = element.type as keyof React.JSX.IntrinsicElements;
        return <HeadingTag key={key}>{children}</HeadingTag>;
      case 'ul':
        return <ul key={key}>{children}</ul>;
      case 'ol':
        return <ol key={key}>{children}</ol>;
      case 'li':
        return <li key={key}>{children}</li>;
      case 'div':
        return (
          <div key={key} className={element.props.className}>
            {children}
          </div>
        );
      case 'span':
        return (
          <span key={key} className={element.props.className}>
            {children}
          </span>
        );
      default:
        // Fallback for unknown types
        return <span key={key}>{children}</span>;
    }
  };

  // Render customized content for markdown blocks (non-interactive)
  // Interactive blocks use the context approach (InteractiveStep handles rendering)
  const renderContent = () => {
    const isInteractiveBlock = blockType === 'interactive' || blockType === 'code';

    // For interactive blocks, use context provider (InteractiveStep will handle rendering)
    if (isInteractiveBlock) {
      return (
        <AssistantBlockValueProvider
          customizedValue={customizedValue}
          isGenerating={isGenerating}
          datasourceType={customizedDatasourceType}
        >
          {children}
        </AssistantBlockValueProvider>
      );
    }

    // For markdown blocks, render customized content using proper markdown parsing
    if (customizedValue) {
      // Strip any @@CLEAR@@ marker (shouldn't be on markdown, but just in case)
      const displayValue = customizedValue.replace(/^@@CLEAR@@\s*/, '');

      // Parse markdown to elements using the same parser as the JSON guide system
      const elements = parseMarkdownToElements(displayValue);

      // Render parsed elements
      return <>{elements.map((el, i) => renderParsedElement(el, `customized-${i}`))}</>;
    }

    // No customization, render original children
    return children;
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
      {renderContent()}
      {renderButton()}
    </div>
  );
}
