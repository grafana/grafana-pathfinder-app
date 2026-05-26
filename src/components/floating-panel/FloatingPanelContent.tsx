import React, { useMemo, useRef } from 'react';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { ContentRenderer } from '../content-renderer/content-renderer';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import type { RawContent } from '../../types/content.types';
import type { LearningJourneyTab, PendingAlignment } from '../../types/content-panel.types';
import {
  AlignmentPrompt,
  LearningJourneyMilestoneToolbar,
  type MilestoneToolbarSurface,
} from '../docs-panel/components';
import { AlignmentPendingContext } from '../../global-state/alignment-pending-context';
import { useLinkClickHandler } from '../docs-panel/link-handler.hook';
import type { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { getFloatingPanelStyles } from './floating-panel.styles';

interface FloatingPanelContentProps {
  hasInteractiveProgress?: boolean;
  progressKey?: string | null;
  onResetGuide?: (progressKey: string, tab: LearningJourneyTab) => Promise<void> | void;
  surface?: MilestoneToolbarSurface;
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
  /**
   * Active tab (used by the link click handler to enrich analytics and to
   * navigate from the cover page's "Ready to Begin" / "Get started" button).
   */
  activeTab: LearningJourneyTab | null;
  /**
   * Panel model used by the link click handler for navigation actions
   * (`loadTab`, milestone navigation, opening docs/journeys from
   * embedded links, etc.). Without this, content links and the
   * "Ready to Begin" CTA on the cover page have no handler.
   */
  model: CombinedLearningJourneyPanel;
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
  activeTab,
  model,
  hasInteractiveProgress,
  progressKey,
  onResetGuide,
  surface = 'floating',
}: FloatingPanelContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const journeyStyles = useStyles2(journeyContentHtml);
  const docsStyles = useStyles2(docsContentHtml);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);
  const floatingStyles = useStyles2(getFloatingPanelStyles);
  // `useTheme2()` is the canonical hook for grabbing the raw theme; the
  // previous `useStyles2((t) => t)` pattern worked but mis-used the
  // CSS-in-JS hook just for theme access.
  const theme = useTheme2();

  // Install the same link click handler the sidebar uses so the
  // "Ready to Begin" / "Get started" CTA, content links, side/related
  // journey links, and the image lightbox all work in floating + fullscreen.
  useLinkClickHandler({
    contentRef,
    activeTab,
    theme,
    model,
  });

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

  const showEmbeddedToolbar = onResetGuide !== undefined && progressKey !== undefined && activeTab !== null;

  return (
    <AlignmentPendingContext.Provider value={alignmentPendingValue}>
      <div ref={contentRef}>
        {showEmbeddedToolbar && activeTab && (
          <div className={floatingStyles.stickyToolbar}>
            <LearningJourneyMilestoneToolbar
              panel={model}
              activeTab={activeTab}
              surface={surface}
              contentRoot={contentRef}
              actionButtonClassName={floatingStyles.secondaryActionButton}
              hasInteractiveProgress={!!hasInteractiveProgress}
              progressKey={progressKey ?? null}
              onResetGuide={onResetGuide!}
              compact
            />
          </div>
        )}
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
