/**
 * Learning-journey milestone toolbar — the consolidated header shown above
 * journey content: nav arrows flanking a title, a "Milestone X of Y"
 * subtitle, a segmented per-milestone progress bar, and a kebab menu for
 * Open / Reset guide / Pop out (or Dock) / Full screen.
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
 * - `contentRoot` lets the sidebar scope the "no interactive steps" DOM
 *   query to its panel's content ref; fullscreen falls back to the global
 *   `[data-pathfinder-content="true"]` selector.
 *
 * The kebab uses `usePanelModeControls()` directly rather than taking a
 * consumer-injected slot, so Pop out/Dock and Full screen are correct on
 * all three surfaces (sidebar, fullscreen, floating) for free — including
 * surfaces that previously had no way to change panel mode from here.
 */

import React from 'react';
import { Button, Dropdown, Menu, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  tabTypeToContentType,
  AnalyticsLinkType,
} from '../../../lib/analytics';
import {
  getJourneyProgress,
  getMilestoneSlug,
  markMilestoneDone,
  resolveExpectedMilestoneIds,
} from '../../../docs-retrieval';
import { usePanelModeControls } from '../../../global-state/use-panel-mode';
import { getMilestoneStyles } from '../../../styles/docs-panel.styles';
import { testIds } from '../../../constants/testIds';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { DocsPanelModelOperations } from '../types';
import { cleanDocsUrl } from '../utils';

export type MilestoneToolbarSurface = 'sidebar' | 'fullscreen' | 'floating';

export interface LearningJourneyMilestoneToolbarProps {
  panel: DocsPanelModelOperations;
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
  /** Hides the kebab menu in space-constrained layouts (the floating panel's compact header). */
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
  hasInteractiveProgress,
  progressKey,
  onResetGuide,
  compact = false,
}: LearningJourneyMilestoneToolbarProps) {
  const styles = useStyles2(getMilestoneStyles);
  const { panelMode, handleTogglePanelMode, handleGoFullScreen } = usePanelModeControls();

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
    if (activeTab.currentUrl) {
      const root: ParentNode =
        contentRoot?.current ?? document.querySelector('[data-pathfinder-content="true"]') ?? document;
      const hasInteractiveSteps = root.querySelectorAll('[data-step-id]').length > 0;
      if (!hasInteractiveSteps) {
        const slug = getMilestoneSlug(activeTab.currentUrl);
        if (slug) {
          void markMilestoneDone(lj.baseUrl, slug, resolveExpectedMilestoneIds(lj), {
            packageManifest: activeTab.content?.metadata?.packageManifest,
            repository: activeTab.content?.metadata?.repository,
            guideTitle: activeTab.title,
          });
        }
      }
    }
    panel.navigateToNextMilestone();
  };

  const currentMs = lj.milestones.find((m) => m.number === (lj.currentMilestone ?? 0));
  const websiteUrl = currentMs?.websiteUrl ?? lj.websiteUrl;
  const fallbackUrl = activeTab.content?.url || activeTab.baseUrl;
  const externalUrl = websiteUrl || fallbackUrl ? cleanDocsUrl(websiteUrl || fallbackUrl!) : undefined;
  const showReset = hasInteractiveProgress || activeTab.type === 'interactive';

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

  const handleOpen = () => {
    if (!externalUrl) {
      return;
    }
    reportAppInteraction(UserInteraction.OpenExtraResource, {
      content_url: externalUrl,
      content_type: getContentTypeForAnalytics(externalUrl, tabTypeToContentType(activeTab.type)),
      link_text: activeTab.title,
      source_page: activeTab.content?.url || activeTab.baseUrl || 'unknown',
      link_type: AnalyticsLinkType.ExternalBrowser,
      interaction_location: openInteractionLocation,
      current_milestone: lj.currentMilestone || 0,
      total_milestones: lj.totalMilestones || 0,
    });
    setTimeout(() => {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
    }, 100);
  };

  const handleReset = async () => {
    if (progressKey) {
      await onResetGuide(progressKey, activeTab);
    }
  };

  const kebabMenu = (
    <Menu>
      {externalUrl && <Menu.Item label={t('docsPanel.open', 'Open')} icon="external-link-alt" onClick={handleOpen} />}
      {showReset && (
        <Menu.Item label={t('docsPanel.resetGuide', 'Reset guide')} icon="history-alt" onClick={handleReset} />
      )}
      {(externalUrl || showReset) && <Menu.Divider />}
      <Menu.Item
        label={panelMode === 'sidebar' ? t('docsPanel.popOut', 'Pop out') : t('docsPanel.dock', 'Dock')}
        ariaLabel={panelMode === 'sidebar' ? 'Pop out to floating panel' : 'Dock guide'}
        icon={panelMode === 'sidebar' ? 'corner-up-right' : 'corner-down-right-alt'}
        onClick={handleTogglePanelMode}
        testId={testIds.docsPanel.popOutButton}
      />
      {panelMode !== 'fullscreen' && (
        <Menu.Item
          label={t('docsPanel.fullScreen', 'Full screen')}
          ariaLabel="Open in full screen"
          icon="expand-arrows"
          onClick={handleGoFullScreen}
          testId={testIds.docsPanel.fullScreenButton}
        />
      )}
    </Menu>
  );

  const segments = Array.from({ length: lj.totalMilestones || 0 }, (_, i) => {
    const number = i + 1;
    if (number < (lj.currentMilestone ?? 0)) {
      return 'done';
    }
    if (number === (lj.currentMilestone ?? 0)) {
      return 'current';
    }
    return 'upcoming';
  });

  return (
    <div className={styles.milestoneProgress}>
      <div className={styles.progressInfo}>
        <div className={styles.progressHeader}>
          <Button
            icon="arrow-left"
            size="md"
            variant="primary"
            aria-label={t('docsPanel.previousMilestone', 'Previous milestone')}
            onClick={handlePrev}
            tooltip={t('docsPanel.previousMilestoneTooltip', 'Previous milestone (Alt + ←)')}
            tooltipPlacement="top"
            disabled={!panel.canNavigatePrevious() || activeTab.isLoading}
          />
          <div className={styles.titleBlock}>
            <div className={styles.milestoneTitle} title={activeTab.title}>
              {activeTab.title}
            </div>
            <div className={styles.milestoneSubtitle}>
              {lj.currentMilestone === 0
                ? t('docsPanel.milestoneIntroduction', 'Introduction ({{total}} milestones)', {
                    total: lj.totalMilestones,
                  })
                : t('docsPanel.milestoneProgress', 'Milestone {{current}} of {{total}}', {
                    current: lj.currentMilestone,
                    total: lj.totalMilestones,
                  })}
            </div>
          </div>
          <Button
            icon="arrow-right"
            size="md"
            variant="primary"
            aria-label={t('docsPanel.nextMilestone', 'Next milestone')}
            onClick={handleNext}
            tooltip={t('docsPanel.nextMilestoneTooltip', 'Next milestone (Alt + →)')}
            tooltipPlacement="top"
            disabled={!panel.canNavigateNext() || activeTab.isLoading}
          />
          {!compact && (
            <Dropdown overlay={kebabMenu} placement="bottom-end">
              <Button
                variant="secondary"
                size="md"
                icon="ellipsis-v"
                tooltip={t('docsPanel.moreActions', 'More actions')}
                aria-label={t('docsPanel.moreActions', 'More actions')}
                data-testid={testIds.docsPanel.milestoneMoreActionsButton}
              />
            </Dropdown>
          )}
        </div>
        <div className={styles.progressSegments}>
          {segments.map((state, index) => (
            <div key={index} className={styles.progressSegment} data-segment-state={state} />
          ))}
        </div>
      </div>
    </div>
  );
}
