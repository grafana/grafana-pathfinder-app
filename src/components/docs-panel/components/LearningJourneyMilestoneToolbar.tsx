/**
 * Learning-journey milestone toolbar — the row of arrow nav, milestone
 * label, action buttons, and progress bar shown above journey content.
 *
 * Why this exists: ~130 lines of identical JSX previously lived in both
 * the sidebar (`docs-panel.tsx`) and the fullscreen panel
 * (`FullScreenPanel.tsx`). Drift between the two copies has produced real
 * bugs (e.g. analytics inconsistencies, missing reset-guide flow on one
 * surface). Centralizing here keeps milestone navigation behavior identical
 * across surfaces and gives us one place to evolve future actions.
 *
 * Surface-specific bits stay in props:
 * - `surface` controls the analytics `interaction_location` for "Open".
 * - `actionButtonClassName` lets each surface inject its own
 *   `secondaryActionButton` className (sidebar reads it from `getStyles`,
 *   fullscreen from `getFullScreenStyles`).
 * - `contentRoot` lets the sidebar scope the "no interactive steps" DOM
 *   query to its panel's content ref; fullscreen falls back to the global
 *   `[data-pathfinder-content="true"]` selector.
 * - `trailingActions` is a slot for the sidebar's `<PanelModeActionButtons>`
 *   + more-options `<Dropdown>`; fullscreen passes nothing.
 */

import React from 'react';
import { Icon, IconButton, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { reportAppInteraction, UserInteraction, getContentTypeForAnalytics } from '../../../lib/analytics';
import { getJourneyProgress, getMilestoneSlug, markMilestoneDone } from '../../../docs-retrieval';
import { getMilestoneStyles } from '../../../styles/docs-panel.styles';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { CombinedLearningJourneyPanel } from '../docs-panel';
import { cleanDocsUrl } from '../utils';

export type MilestoneToolbarSurface = 'sidebar' | 'fullscreen' | 'floating';

export interface LearningJourneyMilestoneToolbarProps {
  panel: CombinedLearningJourneyPanel;
  activeTab: LearningJourneyTab;
  /**
   * Where this toolbar lives — drives the analytics `interaction_location`
   * for the external-link "Open" button so dashboards can distinguish
   * sidebar from fullscreen interactions.
   */
  surface: MilestoneToolbarSurface;
  /**
   * Element whose subtree is searched for `[data-step-id]` to decide
   * whether to mark a step-less milestone done before navigating forward.
   * When omitted, falls back to a global
   * `[data-pathfinder-content="true"]` query (the fullscreen surface).
   */
  contentRoot?: React.RefObject<HTMLElement | null>;
  /**
   * className applied to the Open / Reset action buttons. Each surface
   * passes its own `secondaryActionButton` style so the buttons inherit
   * the surrounding header's visual language.
   */
  actionButtonClassName: string;
  /**
   * From `useGuideProgressState`. Drives the visibility of the
   * "Reset guide" button.
   */
  hasInteractiveProgress: boolean;
  /** From `useGuideProgressState`. Required by the reset handler. */
  progressKey: string | null;
  /**
   * Resolved by the consumer via `useContentReset({ model: panel })` so
   * the toolbar doesn't double-mount that hook (it owns DOM cleanup that
   * must stay aligned with the parent's lifecycle).
   */
  onResetGuide: (progressKey: string, tab: LearningJourneyTab) => Promise<void> | void;
  /**
   * Optional trailing slot rendered after the Open + Reset buttons. The
   * sidebar uses this for `<PanelModeActionButtons>` + the more-options
   * `<Dropdown>`; the fullscreen surface omits it.
   */
  trailingActions?: React.ReactNode;
  compact?: boolean;
}

/**
 * Returns null when the active tab is not a learning-journey or its
 * content hasn't loaded the journey metadata yet — the consumer can
 * always render this component unconditionally.
 */
export function LearningJourneyMilestoneToolbar({
  panel,
  activeTab,
  surface,
  contentRoot,
  actionButtonClassName,
  hasInteractiveProgress,
  progressKey,
  onResetGuide,
  trailingActions,
  compact = false,
}: LearningJourneyMilestoneToolbarProps) {
  const styles = useStyles2(getMilestoneStyles);

  const lj = activeTab.content?.type === 'learning-journey' ? activeTab.content.metadata.learningJourney : undefined;
  const showMilestoneProgress = activeTab.type === 'learning-journey' && Boolean(lj);

  if (!showMilestoneProgress || !lj) {
    return null;
  }

  const handlePrev = () => {
    // Log the destination milestone (where the user is heading TO), not the
    // origin. For a 6-milestone journey, a backward click from M2 logs
    // current_milestone: 1 — matching the toolbar value the user sees after
    // navigation lands. The Math.max clamp is defence-in-depth; the
    // `panel.canNavigatePrevious()` disabled-button gate already prevents
    // navigating past milestone 0 (cover).
    reportAppInteraction(UserInteraction.MilestoneArrowInteractionClick, {
      content_title: activeTab.title,
      content_url: activeTab.baseUrl,
      current_milestone: Math.max(0, (lj.currentMilestone ?? 0) - 1),
      total_milestones: lj.totalMilestones || 0,
      direction: 'backward',
      interaction_location: 'milestone_progress_bar',
      completion_percentage: activeTab.content ? getJourneyProgress(activeTab.content) : 0,
    });
    panel.navigateToPreviousMilestone();
  };

  const handleNext = () => {
    // Log the destination milestone (where the user is heading TO), not the
    // origin. For a 6-milestone journey, a forward click from M5 logs
    // current_milestone: 6 — so the analytics agrees with the toolbar's
    // "Milestone 6 of 6" on the end milestone. The Math.min clamp is
    // defence-in-depth; `panel.canNavigateNext()` already disables the
    // arrow on the last milestone.
    reportAppInteraction(UserInteraction.MilestoneArrowInteractionClick, {
      content_title: activeTab.title,
      content_url: activeTab.baseUrl,
      current_milestone: Math.min(lj.totalMilestones ?? 0, (lj.currentMilestone ?? 0) + 1),
      total_milestones: lj.totalMilestones || 0,
      direction: 'forward',
      interaction_location: 'milestone_progress_bar',
      completion_percentage: activeTab.content ? getJourneyProgress(activeTab.content) : 0,
    });
    // Mirror the legacy behavior: when the current milestone has no
    // interactive steps in the rendered DOM, mark it done so progress
    // advances even though there's nothing to "complete". The DOM scope
    // comes from `contentRoot` (sidebar) or the global content attribute
    // (fullscreen) — both restrict the search to the active panel.
    if (activeTab.currentUrl && activeTab.baseUrl) {
      const root: ParentNode =
        contentRoot?.current ?? document.querySelector('[data-pathfinder-content="true"]') ?? document;
      const hasInteractiveSteps = root.querySelectorAll('[data-step-id]').length > 0;
      if (!hasInteractiveSteps) {
        const slug = getMilestoneSlug(activeTab.currentUrl);
        if (slug) {
          void markMilestoneDone(activeTab.baseUrl, slug, lj.totalMilestones);
        }
      }
    }
    panel.navigateToNextMilestone();
  };

  const currentMs = lj.milestones.find((m) => m.number === (lj.currentMilestone ?? 0));
  const websiteUrl = currentMs?.websiteUrl ?? lj.websiteUrl;
  const fallbackUrl = activeTab.content?.url || activeTab.baseUrl;
  const externalUrl = websiteUrl || fallbackUrl ? cleanDocsUrl(websiteUrl || fallbackUrl!) : undefined;

  // Distinguish surfaces in analytics for the external-link "Open" button.
  // Arrow-nav analytics intentionally stays on `'milestone_progress_bar'`
  // for both surfaces — the sidebar / fullscreen split is only meaningful
  // for the explicit "Open in browser" outbound, not for in-guide nav.
  const openInteractionLocation =
    surface === 'fullscreen'
      ? 'full_screen_milestone_progress_bar'
      : surface === 'floating'
        ? 'floating_panel_milestone_progress_bar'
        : 'milestone_progress_bar';

  return (
    <div className={styles.milestoneProgress}>
      <div className={styles.progressInfo}>
        <div className={styles.progressHeader}>
          <IconButton
            name="arrow-left"
            size="sm"
            aria-label={t('docsPanel.previousMilestone', 'Previous milestone')}
            onClick={handlePrev}
            tooltip={t('docsPanel.previousMilestoneTooltip', 'Previous milestone (Alt + ←)')}
            tooltipPlacement="top"
            disabled={!panel.canNavigatePrevious() || activeTab.isLoading}
            className={styles.navButton}
          />
          <span className={styles.milestoneText}>
            {lj.currentMilestone === 0
              ? t('docsPanel.milestoneIntroduction', 'Introduction ({{total}} milestones)', {
                  total: lj.totalMilestones,
                })
              : t('docsPanel.milestoneProgress', 'Milestone {{current}} of {{total}}', {
                  current: lj.currentMilestone,
                  total: lj.totalMilestones,
                })}
          </span>
          <IconButton
            name="arrow-right"
            size="sm"
            aria-label={t('docsPanel.nextMilestone', 'Next milestone')}
            onClick={handleNext}
            tooltip={t('docsPanel.nextMilestoneTooltip', 'Next milestone (Alt + →)')}
            tooltipPlacement="top"
            disabled={!panel.canNavigateNext() || activeTab.isLoading}
            className={styles.navButton}
          />
        </div>
        {!compact && (
          <div className={styles.milestoneActions}>
            {externalUrl && (
              <button
                className={actionButtonClassName}
                aria-label={t('docsPanel.openInNewTab', 'Open this page in new tab')}
                onClick={() => {
                  reportAppInteraction(UserInteraction.OpenExtraResource, {
                    content_url: externalUrl,
                    content_type: getContentTypeForAnalytics(externalUrl, activeTab.type || 'learning-journey'),
                    link_text: activeTab.title,
                    source_page: activeTab.content?.url || activeTab.baseUrl || 'unknown',
                    link_type: 'external_browser',
                    interaction_location: openInteractionLocation,
                    current_milestone: lj.currentMilestone || 0,
                    total_milestones: lj.totalMilestones || 0,
                  });
                  setTimeout(() => {
                    window.open(externalUrl, '_blank', 'noopener,noreferrer');
                  }, 100);
                }}
              >
                <Icon name="external-link-alt" size="sm" />
                <span>{t('docsPanel.open', 'Open')}</span>
              </button>
            )}
            {(hasInteractiveProgress || activeTab.type === 'interactive') && (
              <button
                className={actionButtonClassName}
                aria-label={t('docsPanel.resetGuide', 'Reset guide')}
                title={t('docsPanel.resetGuideTooltip', 'Resets all interactive steps')}
                onClick={async () => {
                  if (progressKey) {
                    await onResetGuide(progressKey, activeTab);
                  }
                }}
              >
                <Icon name="history-alt" size="sm" />
                <span>{t('docsPanel.resetGuide', 'Reset guide')}</span>
              </button>
            )}
            {trailingActions}
          </div>
        )}
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{
              width: `${((lj.currentMilestone || 0) / (lj.totalMilestones || 1)) * 100}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
