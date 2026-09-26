import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Button } from '@grafana/ui';
import { reportAppInteraction, UserInteraction, buildAssistantCustomizableProperties } from '../../lib/analytics';
import { buildAssistantStorageKey } from '../../lib/storage-keys';
import { type DatasourceMetadataArtifact } from './tools';
import { AssistantBlockValueProvider } from './AssistantBlockValueContext';
import { parseMarkdownToElements, CodeBlock } from '../../docs-retrieval';
import type { ParsedElement } from '../../types/content.types';
import {
  useAssistantGeneration,
  cleanAssistantResponse,
  extractQueryFromResponse,
  buildQuerySystemPrompt,
  buildContentSystemPrompt,
} from './useAssistantGeneration.hook';
import { logger } from '../../lib/logging';

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
    borderLeft: '3px dotted rgb(143, 67, 179)',
    paddingLeft: theme.spacing(2),
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
    '&:hover': {
      borderLeftColor: 'rgb(163, 87, 199)',
    },
  }),
  wrapperCustomized: css({
    borderLeft: `3px solid ${theme.colors.success.border}`,
    paddingLeft: theme.spacing(2),
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
    '&:hover': {
      borderLeftColor: theme.colors.success.main,
    },
  }),
  buttonContainer: css({
    marginBottom: theme.spacing(1),
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap',
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

  const wasGeneratingRef = useRef(false);

  const getInitialCustomizedValue = useCallback((): string | null => {
    try {
      const storageKey = buildAssistantStorageKey(contentKey, assistantId);
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }, [contentKey, assistantId]);

  const [customizedValue, setCustomizedValue] = useState<string | null>(getInitialCustomizedValue);
  const [customizedDatasourceType, setCustomizedDatasourceType] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const isCustomized = customizedValue !== null;

  const generationContextRef = useRef<{ datasourceType: string; blockType: string } | null>(null);

  // SDK v0.1.8 can omit onComplete after tool calls; observe the generation transition too.
  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current;
    wasGeneratingRef.current = isGenerating;

    if (wasGenerating && !isGenerating && content && generationContextRef.current) {
      let customized = cleanAssistantResponse(content);

      const ctx = generationContextRef.current;
      const isQueryBlockWorkaround = ctx?.blockType === 'interactive' || ctx?.blockType === 'code-block';
      if (isQueryBlockWorkaround) {
        customized = extractQueryFromResponse(customized);
      }

      const needsClearMarker = defaultValue.startsWith('@@CLEAR@@');
      const cleanedDefault = defaultValue.replace(/^@@CLEAR@@\s*/, '');

      if (customized && customized !== cleanedDefault) {
        const valueToSave = needsClearMarker ? `@@CLEAR@@ ${customized}` : customized;
        try {
          const storageKey = getStorageKey();
          localStorage.setItem(storageKey, valueToSave);
          setCustomizedValue(valueToSave);

          setCustomizedDatasourceType(ctx.datasourceType);

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
          logger.warn('[AssistantBlockWrapper] Failed to save to localStorage', { error });
        }
      }

      generationContextRef.current = null;
    }
  }, [isGenerating, content, defaultValue, getStorageKey, assistantId, assistantType, contentKey]);

  const [metadataArtifact, setMetadataArtifact] = useState<DatasourceMetadataArtifact | null>(null);

  const datasourceMetadataTool = useMemo(
    () => createMetadataTool((artifact) => setMetadataArtifact(artifact)),
    [createMetadataTool]
  );

  const getAnalyticsContext = useCallback(() => {
    return { assistantId, assistantType, contentKey, inline: false };
  }, [assistantId, assistantType, contentKey]);

  const handleCustomize = useCallback(async () => {
    setGenerationError(null);

    const dsContext = await getDatasourceContext();

    if (!dsContext.currentDatasource) {
      logger.error('[AssistantBlockWrapper] No datasource available');
      setGenerationError('No datasource available. Please select a datasource first.');
      return;
    }

    const datasourceType = dsContext.currentDatasource.type;
    const hasSupportedDatasource = isSupportedDatasource(datasourceType);

    generationContextRef.current = { datasourceType, blockType };

    reportAppInteraction(
      UserInteraction.AssistantCustomizeClick,
      buildAssistantCustomizableProperties(getAnalyticsContext(), {
        datasource_type: datasourceType,
        block_type: blockType,
      })
    );

    const tools = hasSupportedDatasource ? [datasourceMetadataTool] : [];

    const cleanedDefaultValue = defaultValue.replace(/^@@CLEAR@@\s*/, '');
    const isQueryBlock = blockType === 'interactive' || blockType === 'code-block';

    const contextSection = surroundingContext?.before
      ? `Context: This step demonstrates "${surroundingContext.before}"${
          surroundingContext.after ? ` followed by "${surroundingContext.after}"` : ''
        }\n\n`
      : surroundingContext?.after
        ? `Context: This precedes "${surroundingContext.after}"\n\n`
        : '';

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

    const systemPrompt = isQueryBlock
      ? buildQuerySystemPrompt(datasourceType, hasSupportedDatasource)
      : buildContentSystemPrompt(datasourceType, hasSupportedDatasource);

    await generate({
      prompt,
      origin: 'grafana-pathfinder-app/assistant-block-wrapper',
      systemPrompt,
      tools,
      onComplete: (text) => {
        generationContextRef.current = null;

        let customized = cleanAssistantResponse(text);

        const isQueryBlockInCallback = blockType === 'interactive' || blockType === 'code-block';
        if (isQueryBlockInCallback) {
          customized = extractQueryFromResponse(customized);
        }

        const needsClearMarker = defaultValue.startsWith('@@CLEAR@@');
        const cleanedDefault = defaultValue.replace(/^@@CLEAR@@\s*/, '');

        if (customized && customized !== cleanedDefault) {
          const valueToSave = needsClearMarker ? `@@CLEAR@@ ${customized}` : customized;
          try {
            const storageKey = getStorageKey();
            localStorage.setItem(storageKey, valueToSave);
            setCustomizedValue(valueToSave);
            setCustomizedDatasourceType(datasourceType);

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
            logger.warn('[AssistantBlockWrapper] Failed to save to localStorage', { error });
          }
        }
      },
      onError: (err) => {
        logger.error('[AssistantBlockWrapper] Generation failed', { error: err });

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

  const handleRevert = useCallback(() => {
    try {
      const storageKey = getStorageKey();
      localStorage.removeItem(storageKey);
      setCustomizedValue(null);
      setCustomizedDatasourceType(null);
      setGenerationError(null);
      reset();

      reportAppInteraction(
        UserInteraction.AssistantRevertClick,
        buildAssistantCustomizableProperties(getAnalyticsContext(), {
          block_type: blockType,
        })
      );
    } catch (error) {
      logger.warn('[AssistantBlockWrapper] Failed to revert', { error });
    }
  }, [getStorageKey, reset, getAnalyticsContext, blockType]);

  const handleDismissError = useCallback(() => {
    setGenerationError(null);
  }, []);

  const renderButton = () => {
    if (!isAssistantAvailable && !isCustomized && !isGenerating && !generationError) {
      return null;
    }

    return (
      <div className={styles.buttonContainer}>
        <div className={styles.buttonGroup}>
          {generationError ? (
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
                Customize with Assistant
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

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
        return <span key={key}>{children}</span>;
    }
  };

  const renderContent = () => {
    const isInteractiveBlock = blockType === 'interactive' || blockType === 'code-block';

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

    if (customizedValue) {
      const displayValue = customizedValue.replace(/^@@CLEAR@@\s*/, '');

      const elements = parseMarkdownToElements(displayValue);

      return <>{elements.map((el, i) => renderParsedElement(el, `customized-${i}`))}</>;
    }

    return children;
  };

  return (
    <div className={`${styles.wrapper} ${isCustomized ? styles.wrapperCustomized : styles.wrapperDefault}`}>
      {renderButton()}
      {renderContent()}
    </div>
  );
}
