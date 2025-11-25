import React, { useState, useLayoutEffect, RefObject, useCallback } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { OpenAssistantButton, type ChatContextItem } from '@grafana/assistant';
import { buildAssistantPrompt } from './assistant-context.utils';
import type { SelectionPosition } from '../../types/hooks.types';
import { reportAppInteraction, UserInteraction, buildAssistantTextSelectionProperties } from '../../lib/analytics';

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
    background: 'linear-gradient(90deg, rgba(204, 51, 204, 0.08) 0%, rgba(82, 82, 255, 0.08) 100%)', // Purple/blue gradient with transparency to match assistant
    border: '2px solid rgb(143, 67, 179)', // Purple border color (middle of the gradient)
    borderRadius: theme.shape.radius.default,
    boxShadow: '0 0 8px rgba(143, 67, 179, 0.3)', // Purple glow effect to match assistant button
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

  // REACT HOOKS v7: Store calculated positions in state to avoid accessing refs during render
  const [relativePosition, setRelativePosition] = useState<{ top: number; left: number } | null>(null);

  // Track if we've already reported this selection to avoid duplicates
  const [hasTrackedSelection, setHasTrackedSelection] = useState(false);

  // REACT HOOKS v7: Calculate position in useLayoutEffect instead of during render
  useLayoutEffect(() => {
    if (!position || !containerRef.current) {
      // REACT HOOKS v7: Wrap setState in Promise to make it asynchronous
      Promise.resolve().then(() => {
        setRelativePosition(null);
        setHasTrackedSelection(false); // Reset tracking when selection is cleared
      });
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const relativeTop = position.top - (containerRect.top + window.scrollY);
    const relativeLeft = position.left - (containerRect.left + window.scrollX);

    // REACT HOOKS v7: Wrap setState in Promise to make it asynchronous
    Promise.resolve().then(() => setRelativePosition({ top: relativeTop, left: relativeLeft }));
  }, [position, containerRef]);

  // Track text selection when popover becomes visible
  useLayoutEffect(() => {
    if (selectedText && position && relativePosition && !hasTrackedSelection) {
      reportAppInteraction(
        UserInteraction.AssistantTextSelectionMade,
        buildAssistantTextSelectionProperties({
          selectedText,
          selectionLength: selectedText.length,
          buttonPlacement: position.buttonPlacement,
        })
      );
      // REACT HOOKS v7: Wrap setState in Promise to make it asynchronous
      Promise.resolve().then(() => setHasTrackedSelection(true));
    }
  }, [selectedText, position, relativePosition, hasTrackedSelection]);

  // Handle "Ask Assistant" button click
  const handleAskAssistantClick = useCallback(() => {
    if (selectedText && position) {
      reportAppInteraction(
        UserInteraction.AssistantAskButtonClick,
        buildAssistantTextSelectionProperties({
          selectedText,
          selectionLength: selectedText.length,
          buttonPlacement: position.buttonPlacement,
        })
      );
    }
  }, [selectedText, position]);

  // Don't render if no selection or position
  if (!selectedText || !position || !relativePosition) {
    return null;
  }

  // Build the prompt from selected text
  const prompt = buildAssistantPrompt(selectedText);

  return (
    <>
      {/* Highlight box around the selected text - shown for all users */}
      <div
        className={styles.highlightBox}
        style={{
          top: `${relativePosition.top - 4}px`,
          left: `${relativePosition.left - position.width / 2 - 4}px`,
          width: `${position.width}px`,
          height: `${position.height}px`,
        }}
      />

      {/* Button positioned above or below - OpenAssistantButton handles availability check */}
      <div
        className={`${styles.buttonContainer} ${
          position.buttonPlacement === 'top' ? styles.buttonContainerTop : styles.buttonContainerBottom
        }`}
        style={{
          top: `${position.buttonPlacement === 'top' ? relativePosition.top : relativePosition.top + position.height}px`,
          left: `${relativePosition.left}px`,
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          handleAskAssistantClick();
        }}
      >
        <OpenAssistantButton
          prompt={prompt}
          context={context}
          origin="grafana-pathfinder-app/text-selection"
          autoSend={true}
          size="sm"
        />
      </div>
    </>
  );
};

// Memoize the component - only re-render if selected text or container changes
export const AssistantSelectionPopover = React.memo(
  AssistantSelectionPopoverComponent,
  (prev, next) => prev.selectedText === next.selectedText && prev.containerRef === next.containerRef
);
