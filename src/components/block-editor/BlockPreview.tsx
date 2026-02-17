/**
 * Block Preview Component
 *
 * Renders a JsonGuide through the existing content pipeline for live preview.
 * Uses the same styling as the main docs panel for consistent appearance.
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useStyles2, Alert, Badge, Icon } from '@grafana/ui';
import { getBlockPreviewStyles } from './block-editor.styles';
import { parseJsonGuide } from '../../docs-retrieval/json-parser';
import { ContentRenderer } from '../../docs-retrieval/content-renderer';
import { journeyContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import { interactiveStepStorage, interactiveCompletionStorage } from '../../lib/user-storage';
import type { JsonGuide } from './types';
import type { RawContent } from '../../docs-retrieval/content.types';

export interface BlockPreviewProps {
  /** The guide to preview */
  guide: JsonGuide;
}

/**
 * Block preview component
 */
export function BlockPreview({ guide }: BlockPreviewProps) {
  const styles = useStyles2(getBlockPreviewStyles);
  // Apply the same styles as the main docs panel for consistent appearance
  const journeyStyles = useStyles2(journeyContentHtml);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);

  // State for reset functionality
  const [hasInteractiveProgress, setHasInteractiveProgress] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // Progress key matches the URL used in content rendering
  const progressKey = `block-editor://preview/${guide.id}`;

  // Check for interactive progress on mount and when guide changes
  useEffect(() => {
    interactiveStepStorage.hasProgress(progressKey).then(setHasInteractiveProgress);
  }, [progressKey]);

  // Listen for progress saved events to update reset button reactively
  useEffect(() => {
    const handleProgressSaved = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      // Only update if this event is for the current guide's content
      if (detail?.contentKey === progressKey && detail?.hasProgress) {
        setHasInteractiveProgress(true);
      }
    };

    window.addEventListener('interactive-progress-saved', handleProgressSaved);
    return () => {
      window.removeEventListener('interactive-progress-saved', handleProgressSaved);
    };
  }, [progressKey]);

  // Handle reset guide progress
  const handleReset = useCallback(async () => {
    try {
      // Clear storage
      await interactiveStepStorage.clearAllForContent(progressKey);
      await interactiveCompletionStorage.clear(progressKey);

      // Update local state
      setHasInteractiveProgress(false);

      // Dispatch cross-component event (notifies recommendations panel)
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey: progressKey },
        })
      );

      // Increment reset key to force ContentRenderer remount
      setResetKey((prev) => prev + 1);
    } catch (error) {
      console.error('[BlockPreview] Failed to reset guide progress:', error);
    }
  }, [progressKey]);

  // Validate the guide and prepare for rendering
  const { content, errors, warnings, isEmpty } = useMemo(() => {
    // First validate the guide
    const parseResult = parseJsonGuide(guide);

    if (!parseResult.isValid) {
      return {
        content: null,
        errors: parseResult.errors || [],
        warnings: parseResult.warnings || [],
        isEmpty: false,
      };
    }

    // Check if guide has no blocks
    if (!guide.blocks || guide.blocks.length === 0) {
      return {
        content: null,
        errors: [],
        warnings: [],
        isEmpty: true,
      };
    }

    // Create RawContent structure expected by ContentRenderer
    // ContentRenderer expects the raw JSON string as content
    const rawContent: RawContent = {
      content: JSON.stringify(guide),
      metadata: {
        title: guide.title,
      },
      type: 'learning-journey',
      url: `block-editor://preview/${guide.id}`,
      lastFetched: new Date().toISOString(),
      isNativeJson: true,
    };

    return {
      content: rawContent,
      errors: [],
      warnings: parseResult.warnings || [],
      isEmpty: false,
    };
  }, [guide]);

  // Show error state if parsing failed
  if (errors.length > 0) {
    return (
      <div className={styles.container}>
        <Alert title="Preview Error" severity="error">
          <ul>
            {errors.map((error, i) => (
              <li key={i}>{error.message}</li>
            ))}
          </ul>
        </Alert>
      </div>
    );
  }

  // Show empty state if no blocks
  if (isEmpty || !content) {
    return (
      <div className={styles.container}>
        <div className={styles.previewHeader}>
          <h3 className={styles.previewTitle}>{guide.title}</h3>
          <div className={styles.previewActions}>
            <Badge text="Preview" color="blue" className={styles.previewBadge} />
          </div>
        </div>
        <Alert title="Empty Guide" severity="info">
          Add blocks to see a preview of your guide.
        </Alert>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.previewHeader}>
        <h3 className={styles.previewTitle}>{guide.title}</h3>
        <div className={styles.previewActions}>
          {hasInteractiveProgress && (
            <button
              className={styles.resetButton}
              onClick={handleReset}
              aria-label="Reset guide"
              title="Resets all interactive steps"
            >
              <Icon name="history-alt" size="sm" />
              <span>Reset guide</span>
            </button>
          )}
          <Badge text="Preview" color="blue" className={styles.previewBadge} />
        </div>
      </div>

      {/* Show warnings if any */}
      {warnings.length > 0 && (
        <Alert title="Warnings" severity="warning">
          <ul>
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </Alert>
      )}

      {/* Render the content using existing pipeline with proper styling */}
      {/* key={resetKey} forces remount when reset is triggered, resetting all interactive component state */}
      <ContentRenderer
        key={resetKey}
        content={content}
        className={`${journeyStyles} ${interactiveStyles} ${prismStyles}`}
      />
    </div>
  );
}

// Add display name for debugging
BlockPreview.displayName = 'BlockPreview';
