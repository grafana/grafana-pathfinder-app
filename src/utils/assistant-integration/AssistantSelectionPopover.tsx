import React, { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Button, Portal } from '@grafana/ui';
import { openAssistant, type ChatContextItem } from '@grafana/assistant';
import { getIsAssistantAvailable } from './assistant-dev-mode';
import { buildAssistantPrompt } from './assistant-context.utils';
import type { SelectionPosition } from './useTextSelection.hook';

interface AssistantSelectionPopoverProps {
  selectedText: string;
  position: SelectionPosition | null;
  context: ChatContextItem[];
}

const getStyles = (theme: GrafanaTheme2) => ({
  highlightBox: css({
    position: 'absolute',
    zIndex: theme.zIndex.portal - 1,
    backgroundColor: 'rgba(255, 120, 10, 0.1)', // Grafana orange with transparency
    border: `2px solid ${theme.colors.warning.border}`, // Grafana orange border
    borderRadius: theme.shape.radius.default,
    pointerEvents: 'none', // Don't interfere with text selection
  }),
  buttonContainer: css({
    position: 'absolute',
    zIndex: theme.zIndex.portal,
    transform: 'translateX(-50%) translateY(-100%)',
    marginTop: '-8px',
    pointerEvents: 'auto',
  }),
});

/**
 * Popover component that appears above selected text with "Ask Assistant" button
 */
const AssistantSelectionPopoverComponent: React.FC<AssistantSelectionPopoverProps> = ({
  selectedText,
  position,
  context,
}) => {
  const styles = useStyles2(getStyles);

  // Check if dev mode is enabled
  const devModeEnabled = (window as any).__pathfinderPluginConfig?.enableAssistantDevMode ?? false;
  const [isAvailable, setIsAvailable] = useState(devModeEnabled); // Start with devMode value

  // Check if assistant is available (only if NOT in dev mode)
  useEffect(() => {
    if (devModeEnabled) {
      setIsAvailable(true);
      return;
    }

    const subscription = getIsAssistantAvailable().subscribe((available) => {
      setIsAvailable(available);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [devModeEnabled]);

  // Don't render if assistant not available AND dev mode not enabled
  if (!isAvailable && !devModeEnabled) {
    return null;
  }

  // Don't render if no selection or position
  if (!selectedText || !position) {
    return null;
  }

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

  return (
    <Portal>
      {/* Highlight box around the selected text */}
      <div
        className={styles.highlightBox}
        style={{
          top: `${position.top}px`,
          left: `${position.left - position.width / 2}px`,
          width: `${position.width}px`,
          height: `${position.height}px`, // Use actual selection height
        }}
      />

      {/* Button positioned above the highlight box */}
      <div
        className={styles.buttonContainer}
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
        }}
        onMouseDown={(e) => {
          // Stop this from affecting the selection
          e.stopPropagation();
        }}
        onClick={(e) => {
          // Stop this from affecting the selection
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
            backgroundColor: '#FF780A', // Grafana orange
            borderColor: '#FF780A',
            color: 'white',
          }}
        >
          Ask Assistant
        </Button>
      </div>
    </Portal>
  );
};

// Memoize the component - only re-render if selected text changes
export const AssistantSelectionPopover = React.memo(
  AssistantSelectionPopoverComponent,
  (prev, next) => prev.selectedText === next.selectedText
);
