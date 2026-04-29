import React, { useMemo, useRef } from 'react';
import { useStyles2 } from '@grafana/ui';
import { ContentRenderer } from '../../docs-retrieval';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import type { RawContent } from '../../types/content.types';
import type { PendingAlignment } from '../../types/content-panel.types';
import { AlignmentPrompt } from '../docs-panel/components';
import { AlignmentPendingContext } from '../../global-state/alignment-pending-context';

interface FloatingPanelContentProps {
  /** The guide content to render */
  content: RawContent | null;
  /** Called when a guide completes all interactive sections */
  onGuideComplete?: () => void;
  /**
   * Active tab's pending alignment (implied 0th step) — when set, renders the
   * `<AlignmentPrompt>` banner above `<ContentRenderer>`. The component itself
   * does NOT suppress the renderer; step 1 is paused via
   * `AlignmentPendingContext` (`useStepChecker.isEligibleForChecking` gate)
   * which the wrapping provider supplies.
   */
  pendingAlignment?: PendingAlignment;
  /** Confirm callback for the alignment prompt */
  onAlignmentConfirm?: () => void;
  /** Cancel callback for the alignment prompt */
  onAlignmentCancel?: () => void;
}

/**
 * Renders guide content inside the floating panel.
 *
 * Uses the same full scrollable view as the sidebar — the guide renders
 * identically with all sections, auto-collapse on completion, and the
 * full interactive engine. No pagination or step slicing.
 */
export function FloatingPanelContent({
  content,
  onGuideComplete,
  pendingAlignment,
  onAlignmentConfirm,
  onAlignmentCancel,
}: FloatingPanelContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const journeyStyles = useStyles2(journeyContentHtml);
  const docsStyles = useStyles2(docsContentHtml);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);

  // STABILITY: Memoize the context value keyed on the two underlying
  // primitives. React context uses referential equality, so an inline object
  // literal would force every `useStepChecker` consumer (one per interactive
  // section) to re-render on every parent render — re-evaluating eligibility
  // and re-subscribing listeners. See the matching pattern in `docs-panel.tsx`.
  // NOTE: Computed before any early return to keep hook order stable.
  const alignmentIsPending = !!pendingAlignment;
  const alignmentStartingLocation = pendingAlignment?.startingLocation ?? null;
  const alignmentPendingValue = useMemo(
    () => ({
      isPending: alignmentIsPending,
      startingLocation: alignmentStartingLocation,
    }),
    [alignmentIsPending, alignmentStartingLocation]
  );

  if (!content) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)' }}>No guide content loaded</div>
    );
  }

  const contentClassName = `${content.type === 'learning-journey' ? journeyStyles : docsStyles} ${interactiveStyles} ${prismStyles}`;

  return (
    <AlignmentPendingContext.Provider value={alignmentPendingValue}>
      <div ref={contentRef}>
        {pendingAlignment && onAlignmentConfirm && onAlignmentCancel && (
          <div style={{ padding: 16 }}>
            <AlignmentPrompt
              startingLocation={pendingAlignment.startingLocation}
              onConfirm={onAlignmentConfirm}
              onCancel={onAlignmentCancel}
            />
          </div>
        )}
        <ContentRenderer
          key={content.url}
          content={content}
          containerRef={contentRef}
          className={contentClassName}
          onGuideComplete={onGuideComplete}
        />
      </div>
    </AlignmentPendingContext.Provider>
  );
}
