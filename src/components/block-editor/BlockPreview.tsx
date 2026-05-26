/**
 * Block Preview Component
 *
 * Renders a JsonGuide through the existing content pipeline for live preview.
 * Uses the same styling as the main docs panel for consistent appearance.
 */

import React, { useMemo, useState, useEffect } from 'react';
import { useStyles2, Alert, Icon } from '@grafana/ui';
import { getBlockPreviewStyles } from './block-editor.styles';
import { parseJsonGuide } from '../../docs-retrieval';
import { ContentRenderer } from '../content-renderer/content-renderer';
import { journeyContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import { useGuidePreviewProgress } from './hooks/useGuidePreviewProgress';
import { matchesContentKey, subscribeProgressEvent } from '../../global-state/progress-events';
import type { JsonGuide } from './types';
import type { RawContent } from '../../types/content.types';
import { testIds } from '../../constants/testIds';

export interface BlockPreviewProps {
  /** The guide to preview */
  guide: JsonGuide;
  /** Whether to render the guide title above native JSON content. */
  showTitle?: boolean;
  /**
   * Hide the built-in "Reset guide" button. Use this when a parent surface
   * (e.g. BlockEditorHeader) is responsible for rendering the reset action,
   * to avoid duplicating editor chrome inside the rendered content.
   */
  hideResetButton?: boolean;
}

/**
 * Block preview component
 */
export function BlockPreview({ guide, showTitle = true, hideResetButton = false }: BlockPreviewProps) {
  const styles = useStyles2(getBlockPreviewStyles);
  // Apply the same styles as the main docs panel for consistent appearance
  const journeyStyles = useStyles2(journeyContentHtml);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);

  // Progress key matches the URL used in content rendering
  const progressKey = `block-editor://preview/${guide.id}`;
  const { hasProgress: hasInteractiveProgress, reset } = useGuidePreviewProgress(progressKey);

  // Force ContentRenderer remount when progress is cleared (locally or by a
  // sibling surface like BlockEditorHeader). All clears flow through
  // `pathfinder:progress` with `kind: 'guide'` and `hasProgress: false`;
  // wildcard `contentKey: '*'` clears (e.g. "reset all") also bump the key.
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    return subscribeProgressEvent((detail) => {
      if (detail.kind === 'guide' && !detail.hasProgress && matchesContentKey(detail, progressKey)) {
        setResetKey((prev) => prev + 1);
      }
    });
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
        title: showTitle ? guide.title : '',
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
  }, [guide, showTitle]);

  // Show error state if parsing failed
  if (errors.length > 0) {
    return (
      <div className={styles.container}>
        <Alert title="Preview error" severity="error">
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
        <Alert title="Empty guide" severity="info">
          Add blocks to see a preview of your guide.
        </Alert>
      </div>
    );
  }

  // Explicit keys on every sibling (#842, Phase 6): the conditional
  // warnings alert + the conditional reset-actions div appear and
  // disappear independently as state changes. React's child-array
  // reconciliation treats unkeyed siblings positionally; without
  // stable keys, an appearance / disappearance of one sibling can
  // cause React to reconcile ContentRenderer into a different slot,
  // which in turn may trigger an unwanted remount and silently reset
  // the section's reducer state. Keeping every sibling keyed pins
  // ContentRenderer's identity across hasInteractiveProgress flips.
  return (
    <div className={styles.container}>
      {warnings.length > 0 && (
        <Alert key="preview-warnings" title="Warnings" severity="warning">
          <ul>
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </Alert>
      )}

      {hasInteractiveProgress && !hideResetButton && (
        <div key="preview-reset-actions" className={styles.resetActions}>
          <button
            className={styles.resetButton}
            onClick={() => void reset()}
            aria-label="Reset guide"
            title="Resets all interactive steps"
            data-testid={testIds.blockEditor.previewResetButton}
          >
            <Icon name="history-alt" size="sm" />
            <span>Reset guide</span>
          </button>
        </div>
      )}

      {/* `key={resetKey}` forces remount when a Reset guide click bumps
         the counter, intentionally clearing all interactive component
         state. The composite key prefix keeps ContentRenderer's slot
         distinct from the conditional siblings above so the keyed
         remount path is the ONLY remount path. */}
      <ContentRenderer
        key={`preview-content-${resetKey}`}
        content={content}
        className={`${journeyStyles} ${interactiveStyles} ${prismStyles} ${styles.previewContent}`}
      />
    </div>
  );
}

// Add display name for debugging
BlockPreview.displayName = 'BlockPreview';
