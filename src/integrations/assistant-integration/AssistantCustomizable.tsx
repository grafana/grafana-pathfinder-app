import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { useAssistantCustomizableContext } from './AssistantCustomizableContext';
import { reportAppInteraction, UserInteraction, buildAssistantCustomizableProperties } from '../../lib/analytics';

export interface AssistantCustomizableProps {
  /** Default value from the HTML */
  defaultValue: string;
  /** Unique ID for this assistant element */
  assistantId: string;
  /** Type of content (query, config, etc.) */
  assistantType: string;
  /** Whether to render inline or as a block */
  inline: boolean;
  /** Current content URL for localStorage key */
  contentKey: string;
}

// REACT: Stable array reference to prevent context thrashing (R3)
const EMPTY_CONTEXT_DEPS: ChatContextItem[] = [];

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    position: 'relative',
    display: 'inline-block',
  }),
  blockWrapper: css({
    position: 'relative',
    display: 'block',
  }),
  inlineValue: css({
    borderBottom: '2px dotted',
    borderColor: 'rgb(143, 67, 179)', // Purple to match assistant button
    cursor: 'pointer',
    '&:hover': {
      borderColor: 'rgb(163, 87, 199)', // Lighter purple on hover
    },
  }),
  inlineValueCustomized: css({
    borderBottom: '2px solid',
    borderColor: theme.colors.success.border, // Green for customized
    cursor: 'pointer',
    '&:hover': {
      borderColor: theme.colors.success.main,
    },
  }),
  blockValue: css({
    borderLeft: '3px dotted rgb(143, 67, 179)', // Purple to match assistant button
    padding: theme.spacing(2),
    cursor: 'pointer',
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    overflow: 'auto',
    '&:hover': {
      borderLeftColor: 'rgb(163, 87, 199)', // Lighter purple on hover
    },
  }),
  blockValueCustomized: css({
    borderLeft: `3px solid ${theme.colors.success.border}`, // Green for customized
    padding: theme.spacing(2),
    cursor: 'pointer',
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    overflow: 'auto',
    '&:hover': {
      borderLeftColor: theme.colors.success.main,
    },
  }),
  buttonContainer: css({
    position: 'absolute',
    top: '-48px', // Position above the text
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
 * Assistant Customizable Element Component
 *
 * Displays default content with the ability to customize via Grafana Assistant.
 * Customizations are stored in localStorage and can be reverted.
 */
export function AssistantCustomizable({
  defaultValue,
  assistantId,
  assistantType,
  inline,
  contentKey,
}: AssistantCustomizableProps) {
  const styles = useStyles2(getStyles);
  const containerRef = useRef<HTMLDivElement | HTMLSpanElement>(null);

  // Check if dev mode is enabled
  const devModeEnabled = isAssistantDevModeEnabledGlobal();

  // Use the inline assistant hook for generating customized content
  // In dev mode, use mock implementation; otherwise use real hook
  const realInlineAssistant = useInlineAssistant();
  const mockInlineAssistant = useMockInlineAssistant();
  const { generate, isGenerating, reset } = devModeEnabled ? mockInlineAssistant : realInlineAssistant;

  // Generate localStorage key
  const getStorageKey = useCallback((): string => {
    return `pathfinder-assistant-${contentKey}-${assistantId}`;
  }, [contentKey, assistantId]);

  // Load initial value from localStorage using lazy initialization
  const getInitialValue = useCallback(() => {
    try {
      const storageKey = `pathfinder-assistant-${contentKey}-${assistantId}`;
      const storedValue = localStorage.getItem(storageKey);
      return storedValue || defaultValue;
    } catch (error) {
      console.warn('[AssistantCustomizable] Failed to load from localStorage:', error);
      return defaultValue;
    }
  }, [contentKey, assistantId, defaultValue]);

  const getInitialCustomizedState = useCallback(() => {
    try {
      const storageKey = `pathfinder-assistant-${contentKey}-${assistantId}`;
      const storedValue = localStorage.getItem(storageKey);
      return storedValue !== null;
    } catch (error) {
      return false;
    }
  }, [contentKey, assistantId]);

  // State management with lazy initialization
  const [currentValue, setCurrentValue] = useState(getInitialValue);
  const [isCustomized, setIsCustomized] = useState(getInitialCustomizedState);
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isAssistantAvailable, setIsAssistantAvailable] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | HTMLDivElement>(null);
  const isInitialMount = useRef(true);

  // Provide page context for datasource - the assistant will automatically use this
  const setPageContext = useProvidePageContext('/explore', EMPTY_CONTEXT_DEPS);

  // Get context from parent InteractiveStep (if available)
  const customizableContext = useAssistantCustomizableContext();

  // Update parent interactive step's targetValue on mount if customized (using React context)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;

      if (isCustomized && currentValue !== defaultValue && customizableContext) {
        customizableContext.updateTargetValue(currentValue);
      }
    }
  }, [isCustomized, currentValue, defaultValue, customizableContext]);

  // Check if assistant is available
  useEffect(() => {
    const subscription = getIsAssistantAvailable().subscribe((available: boolean) => {
      setIsAssistantAvailable(available);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Save customized value to localStorage
  // Note: This function is available for future use when assistant API callback is implemented
  // const saveCustomizedValue = useCallback((value: string) => {
  //   try {
  //     const storageKey = getStorageKey();
  //     localStorage.setItem(storageKey, value);
  //     setCurrentValue(value);
  //     setIsCustomized(true);
  //   } catch (error) {
  //     console.warn('[AssistantCustomizable] Failed to save to localStorage:', error);
  //   }
  // }, [getStorageKey]);

  // Save customized value to localStorage
  const saveCustomizedValue = useCallback(
    (value: string) => {
      try {
        const storageKey = getStorageKey();
        localStorage.setItem(storageKey, value);
        setCurrentValue(value);
        setIsCustomized(true);

        // Update parent interactive step's targetValue using React context
        if (customizableContext) {
          customizableContext.updateTargetValue(value);
        }
      } catch (error) {
        console.warn('[AssistantCustomizable] Failed to save to localStorage:', error);
      }
    },
    [getStorageKey, customizableContext]
  );

  // Get datasource context for assistant and provide it via page context
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
      console.warn('[AssistantCustomizable] Failed to fetch datasources:', error);
      return { dataSources: [], currentDatasource: null };
    }
  }, [setPageContext]);

  // Build analytics context for this customizable element
  const getAnalyticsContext = useCallback(() => {
    return { assistantId, assistantType, contentKey, inline };
  }, [assistantId, assistantType, contentKey, inline]);

  // Handle customize button click
  const handleCustomize = useCallback(async () => {
    // Get datasource context
    const dsContext = await getDatasourceContext();

    if (!dsContext.currentDatasource) {
      console.error('[AssistantCustomizable] No datasource available');
      return;
    }

    // Build datasource context for the prompt
    const datasourceType = dsContext.currentDatasource.type;

    // Track customize button click
    reportAppInteraction(
      UserInteraction.AssistantCustomizeClick,
      buildAssistantCustomizableProperties(getAnalyticsContext(), {
        datasource_type: datasourceType,
      })
    );

    // Simplified prompt - inline assistant will make educated guesses based on common patterns
    const prompt = `Customize this ${assistantType} for a ${datasourceType} datasource using realistic metric names.

Original query:
${defaultValue}

Adapt this to use common ${datasourceType} metrics and labels that typically exist. Keep the same query pattern and purpose.

Return only the customized query text.`;

    const systemPrompt = `You are a Grafana ${datasourceType} query expert.

Customize queries to use realistic, commonly-available metrics for ${datasourceType}.

For Prometheus: use metrics like up, prometheus_*, node_*, process_*, go_*, http_requests_total
Common labels: job, instance, status, method, handler

Output only the query - no markdown, no explanation.`;

    // Generate with inline assistant
    await generate({
      prompt,
      origin: 'grafana-pathfinder-app/assistant-customizable',
      systemPrompt,
      onComplete: (text) => {
        // Clean up the response (remove markdown code blocks if present)
        let customized = text.trim();
        customized = customized.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
        customized = customized.trim();

        if (customized && customized !== defaultValue) {
          saveCustomizedValue(customized);
          setIsPinned(false);

          // Track successful customization
          reportAppInteraction(
            UserInteraction.AssistantCustomizeSuccess,
            buildAssistantCustomizableProperties(getAnalyticsContext(), {
              datasource_type: datasourceType,
              original_length: defaultValue.length,
              customized_length: customized.length,
            })
          );
        }
      },
      onError: (err) => {
        console.error('[AssistantCustomizable] Generation failed:', err);

        // Track customization error
        reportAppInteraction(
          UserInteraction.AssistantCustomizeError,
          buildAssistantCustomizableProperties(getAnalyticsContext(), {
            datasource_type: datasourceType,
            error_message: err instanceof Error ? err.message : 'Unknown error',
          })
        );
      },
    });
  }, [assistantType, defaultValue, generate, saveCustomizedValue, getDatasourceContext, getAnalyticsContext]);

  // Handle revert button click
  const handleRevert = useCallback(() => {
    try {
      const storageKey = getStorageKey();
      const previousValue = currentValue; // Capture before clearing
      localStorage.removeItem(storageKey);
      setCurrentValue(defaultValue);
      setIsCustomized(false);
      setIsPinned(false);
      reset(); // Clear any assistant state

      // Restore parent interactive step's targetValue to original using React context
      if (customizableContext) {
        customizableContext.updateTargetValue(defaultValue);
      }

      // Track revert action
      reportAppInteraction(
        UserInteraction.AssistantRevertClick,
        buildAssistantCustomizableProperties(getAnalyticsContext(), {
          reverted_from_length: previousValue.length,
          reverted_to_length: defaultValue.length,
        })
      );
    } catch (error) {
      console.warn('[AssistantCustomizable] Failed to revert:', error);
    }
  }, [getStorageKey, defaultValue, reset, customizableContext, currentValue, getAnalyticsContext]);

  // Mouse handlers
  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isPinned) {
      setIsHovered(false);
    }
  }, [isPinned]);

  // Click handler to pin/unpin the button
  const handleTextClick = useCallback(() => {
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
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPinned]);

  // Show button if hovered OR pinned, and assistant is available
  const showButton = (isHovered || isPinned) && isAssistantAvailable;

  // Render button (shared between inline and block)
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

  // Render inline version
  if (inline) {
    return (
      <span className={styles.wrapper} ref={wrapperRef as React.RefObject<HTMLSpanElement>}>
        <span
          ref={containerRef as React.RefObject<HTMLSpanElement>}
          className={isCustomized ? styles.inlineValueCustomized : styles.inlineValue}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleTextClick}
          title={isCustomized ? 'Customized by Assistant (click to revert)' : 'Click to customize'}
        >
          {currentValue}
        </span>
        {renderButton()}
      </span>
    );
  }

  // Render block version
  return (
    <div className={styles.blockWrapper} ref={wrapperRef as React.RefObject<HTMLDivElement>}>
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className={isCustomized ? styles.blockValueCustomized : styles.blockValue}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleTextClick}
        title={isCustomized ? 'Customized (click to revert)' : 'Click to customize'}
      >
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{currentValue}</pre>
      </div>
      {renderButton()}
    </div>
  );
}
