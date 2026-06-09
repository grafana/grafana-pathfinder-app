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
import { guideHasSnippetRefs, inlineSnippetRefsInGuide } from '../../snippet-engine';
import { ContentRenderer } from '../content-renderer/content-renderer';
import { journeyContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import { useGuidePreviewProgress } from './hooks/useGuidePreviewProgress';
import type { JsonGuide } from './types';
import type { ContentParseResult, RawContent } from '../../types/content.types';
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

  // Force ContentRenderer remount when progress is cleared (locally or by a sibling
  // surface like BlockEditorHeader). All clears flow through `interactive-progress-cleared`.
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    const handleCleared = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.contentKey === progressKey) {
        setResetKey((prev) => prev + 1);
      }
    };
    window.addEventListener('interactive-progress-cleared', handleCleared);
    return () => {
      window.removeEventListener('interactive-progress-cleared', handleCleared);
    };
  }, [progressKey]);

  // ContentRenderer resolves snippet refs downstream before it renders, so
  // validating the raw guide would flag every valid `snippet-ref` as
  // unresolved. Mirror ContentRenderer: parse synchronously, then re-parse
  // against the inlined guide when the guide references snippets.
  const baseValidation = useMemo(() => parseJsonGuide(guide), [guide]);
  const hasSnippetRefs = useMemo(() => guideHasSnippetRefs(guide), [guide]);
  // Tag the result with the guide it was computed for so a stale result from
  // a previous guide is ignored during render.
  const [resolved, setResolved] = useState<{ guide: JsonGuide; result: ContentParseResult } | null>(null);

  useEffect(() => {
    if (!hasSnippetRefs) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const inlined = await inlineSnippetRefsInGuide(guide);
      if (!cancelled) {
        setResolved({ guide, result: parseJsonGuide(inlined) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guide, hasSnippetRefs]);

  const resolvedValidation = resolved?.guide === guide ? resolved.result : null;

  // While a snippet-referencing guide is still inlining, fall back to the base
  // parse for structural errors but withhold its snippet-ref warnings — those
  // resolve away once inlining completes.
  const resolving = hasSnippetRefs && resolvedValidation === null;
  const validation = resolvedValidation ?? baseValidation;
  const errors = validation.errors || [];
  const warnings = resolving ? [] : validation.warnings || [];

  // Keyed on the guide alone so the async validation update never churns
  // ContentRenderer's content identity.
  const { content, isEmpty } = useMemo(() => {
    if (!guide.blocks || guide.blocks.length === 0) {
      return { content: null, isEmpty: true };
    }

    // ContentRenderer expects the raw JSON string as content.
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

    return { content: rawContent, isEmpty: false };
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
