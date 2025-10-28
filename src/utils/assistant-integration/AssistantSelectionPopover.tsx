import React, { useState, useEffect, RefObject } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Button } from '@grafana/ui';
import { openAssistant, type ChatContextItem } from '@grafana/assistant';
import { getIsAssistantAvailable } from './assistant-dev-mode';
import { buildAssistantPrompt } from './assistant-context.utils';
import type { SelectionPosition } from './useTextSelection.hook';

interface AssistantSelectionPopoverProps {
  selectedText: string;
  position: SelectionPosition | null;
  context: ChatContextItem[];
  containerRef: RefObject<HTMLElement>;
}

const getStyles = (theme: GrafanaTheme2) => ({
  highlightBox: css({
    position: 'absolute',
    zIndex: theme.zIndex.portal - 1,
    backgroundColor: 'rgba(255, 120, 10, 0.1)', // Grafana orange with transparency
    border: `2px solid ${theme.colors.warning.border}`, // 2px border
    borderRadius: theme.shape.radius.default,
    pointerEvents: 'none', // Don't interfere with text selection
    // Add padding to make box bigger than text (so border doesn't cover text)
    padding: '4px',
    boxSizing: 'content-box', // Padding adds to size, not reduces content area
  }),
  buttonContainer: css({
    position: 'absolute',
    zIndex: theme.zIndex.portal,
    pointerEvents: 'auto',
  }),
  buttonContainerTop: css({
    transform: 'translateX(-50%) translateY(-100%)',
    marginTop: '-8px',
  }),
  buttonContainerBottom: css({
    transform: 'translateX(-50%)',
    marginTop: '8px',
  }),
});

/**
 * Popover component that appears above selected text with "Ask Assistant" button
 */
const AssistantSelectionPopoverComponent: React.FC<AssistantSelectionPopoverProps> = ({
  selectedText,
  position,
  context,
  containerRef,
}) => {
  const styles = useStyles2(getStyles);

  // Check if dev mode is enabled
  const devModeEnabled = (window as any).__pathfinderPluginConfig?.enableAssistantDevMode ?? false;
  const [isAssistantAvailable, setIsAssistantAvailable] = useState(devModeEnabled);

  // Check if assistant is available (only if NOT in dev mode)
  useEffect(() => {
    if (devModeEnabled) {
      setIsAssistantAvailable(true);
      return;
    }

    const subscription = getIsAssistantAvailable().subscribe((available) => {
      setIsAssistantAvailable(available);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [devModeEnabled]);

  // Don't render if no selection or position
  if (!selectedText || !position) {
    return null;
  }

  // Show button only if assistant is available or dev mode enabled
  const showButton = isAssistantAvailable || devModeEnabled;

  const handleAskAssistant = () => {
    const prompt = buildAssistantPrompt(selectedText);

    if (devModeEnabled) {
      // Dev mode: log to console
      console.warn('=== Assistant Dev Mode ===');
      console.warn('Origin: grafana-pathfinder-app/text-selection');
      console.warn('Prompt:', prompt);
      console.warn('Context (includes doc metadata):', context);
      console.warn('AutoSend: true');
      console.warn('=========================');
    } else {
      // Production: open real assistant
      openAssistant({
        origin: 'grafana-pathfinder-app/text-selection',
        prompt,
        context,
        autoSend: true,
      });
    }

    window.getSelection()?.removeAllRanges();
  };

  // Calculate position relative to container instead of page
  const containerRect = containerRef.current?.getBoundingClientRect();
  if (!containerRect) {
    return null;
  }

  // Convert page coordinates to container-relative coordinates
  const relativeTop = position.top - (containerRect.top + window.scrollY);
  const relativeLeft = position.left - (containerRect.left + window.scrollX);

  return (
    <>
      {/* Highlight box around the selected text - shown for all users */}
      <div
        className={styles.highlightBox}
        style={{
          top: `${relativeTop - 4}px`,
          left: `${relativeLeft - position.width / 2 - 4}px`,
          width: `${position.width}px`,
          height: `${position.height}px`,
        }}
      />

      {/* Button positioned above or below - only shown if assistant available */}
      {showButton && (
        <div
          className={`${styles.buttonContainer} ${
            position.buttonPlacement === 'top' ? styles.buttonContainerTop : styles.buttonContainerBottom
          }`}
          style={{
            top: `${position.buttonPlacement === 'top' ? relativeTop : relativeTop + position.height}px`,
            left: `${relativeLeft}px`,
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <Button
            icon="ai"
            size="sm"
            variant="secondary"
            fill="solid"
            onClick={handleAskAssistant}
            style={{
              backgroundColor: '#D94F00', // Darker Grafana orange
              borderColor: '#D94F00',
              color: 'white',
            }}
          >
            Ask Assistant
          </Button>
        </div>
      )}
    </>
  );
};

// Memoize the component - only re-render if selected text or container changes
export const AssistantSelectionPopover = React.memo(
  AssistantSelectionPopoverComponent,
  (prev, next) => prev.selectedText === next.selectedText && prev.containerRef === next.containerRef
);
