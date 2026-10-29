import React, { useRef, useEffect, useCallback } from 'react';
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
}

const getStyles = (theme: GrafanaTheme2) => ({
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

const AssistantSelectionPopoverComponent: React.FC<AssistantSelectionPopoverProps> = ({
  selectedText,
  position,
  context,
}) => {
  const styles = useStyles2(getStyles);

  const trackedSelection = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedText || !position) {
      trackedSelection.current = null;
      return;
    }
    if (trackedSelection.current !== selectedText) {
      reportAppInteraction(
        UserInteraction.AssistantTextSelectionMade,
        buildAssistantTextSelectionProperties({
          selectedText,
          selectionLength: selectedText.length,
          buttonPlacement: position.buttonPlacement,
        })
      );
      trackedSelection.current = selectedText;
    }
  }, [selectedText, position]);

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

  if (!selectedText || !position) {
    return null;
  }

  const prompt = buildAssistantPrompt(selectedText);

  return (
    <div
      className={`${styles.buttonContainer} ${
        position.buttonPlacement === 'top' ? styles.buttonContainerTop : styles.buttonContainerBottom
      }`}
      style={{
        top: `${position.buttonPlacement === 'top' ? position.top : position.top + position.height}px`,
        left: `${position.left}px`,
      }}
      onMouseDown={(e) => {
        // Keep the native selection intact until the assistant receives it.
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseUp={(e) => e.stopPropagation()}
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
        title="Ask Assistant"
      />
    </div>
  );
};

export const AssistantSelectionPopover = React.memo(AssistantSelectionPopoverComponent);
