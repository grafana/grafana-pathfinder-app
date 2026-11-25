/**
 * Learning-journey milestone toolbar — the consolidated header shown above
 * journey content: nav arrows flanking a title, a completion count,
 * a segmented per-milestone progress bar, and a kebab menu for
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
 *
 * The kebab uses `usePanelModeControls()` directly rather than taking a
 * consumer-injected slot, so Pop out/Dock and Full screen are correct on
 * all three surfaces (sidebar, fullscreen, floating) for free — including
 * surfaces that previously had no way to change panel mode from here.
 */

import React from 'react';
import { Dropdown, IconButton, Menu, Tooltip, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { PathLessonHeader } from '../../LearningPaths/PathLessonHeader';
import { usePathLessonProgress } from '../../LearningPaths/PathLessonProgressBar';

import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  tabTypeToContentType,
  AnalyticsLinkType,
} from '../../../lib/analytics';
import { percentagesToProgress, resolveActiveMilestoneToolbarContext } from '../../../docs-retrieval';
import { usePanelModeControls } from '../../../global-state/use-panel-mode';
import { getMilestoneStyles } from '../../../styles/docs-panel.styles';
import { testIds } from '../../../constants/testIds';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { DocsPanelModelOperations } from '../types';
import { cleanDocsUrl } from '../utils';
import { usePathfinderPluginConfig } from '../../../hooks';
import { parseUrlSafely } from '../../../security';
import { pickControllerTabOpenAction } from '../utils/controller-tab-open-action';

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
  hasInteractiveProgress,
  progressKey,
  onResetGuide,
  compact = false,
}: LearningJourneyMilestoneToolbarProps) {
  const styles = useStyles2(getMilestoneStyles, surface);
  const { config: pluginConfig } = usePathfinderPluginConfig();
  const { panelMode, handleTogglePanelMode, handleGoFullScreen } = usePanelModeControls();
  // Scoped to whichever sequence the reader actually navigated through —
  // base Foundations or their active Path Track (`activeTab.activeTrackId`/
  // `activeTrackMilestones`) — so a track-only guide (no `learningJourney` at
  // all) still gets nav/label/progress, and a guide that's a member of BOTH
  // sequences shows the one the reader is actually in rather than always the
  // base sequence. See `resolveActiveMilestoneToolbarContext`.
  const activeMilestoneContext =
    activeTab.type === 'learning-journey' && activeTab.content
      ? resolveActiveMilestoneToolbarContext(
          activeTab.content,
          activeTab.activeTrackId,
          activeTab.activeTrackMilestones
        )
      : null;
  const progress = usePathLessonProgress(activeMilestoneContext);

  if (!activeMilestoneContext) {
    return null;
  }

  const currentTitle =
    activeMilestoneContext.milestones.find(({ number }) => number === activeMilestoneContext.currentMilestone)?.title ||
    activeTab.title;
  const completionPercentage = percentagesToProgress(progress.percentages);

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
      current_milestone: Math.max(0, activeMilestoneContext.currentMilestone - 1),
      total_milestones: activeMilestoneContext.totalMilestones,
      direction: 'backward',
      interaction_location: 'milestone_progress_bar',
      completion_percentage: completionPercentage,
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
      current_milestone: Math.min(activeMilestoneContext.totalMilestones, activeMilestoneContext.currentMilestone + 1),
      total_milestones: activeMilestoneContext.totalMilestones,
      direction: 'forward',
      interaction_location: 'milestone_progress_bar',
      completion_percentage: completionPercentage,
    });
    panel.navigateToNextMilestone();
  };

  const currentMs = activeMilestoneContext.milestones.find((m) => m.number === activeMilestoneContext.currentMilestone);
  const websiteUrl = currentMs?.websiteUrl ?? activeMilestoneContext.websiteUrl;
  const fallbackUrl = activeTab.content?.url || activeTab.baseUrl;
  const isPrivatePath =
    activeMilestoneContext.baseUrl.startsWith('backend-guide:') ||
    activeTab.content?.metadata.repository === 'app-platform' ||
    activeTab.content?.metadata.journeyManifest?.repository === 'app-platform' ||
    activeTab.content?.metadata.packageManifest?.repository === 'app-platform';
  const candidateUrl = !isPrivatePath && (websiteUrl || fallbackUrl);
  const parsedUrl = candidateUrl ? parseUrlSafely(candidateUrl) : null;
  const externalUrl =
    parsedUrl && (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:')
      ? cleanDocsUrl(parsedUrl.href)
      : undefined;
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
      current_milestone: activeMilestoneContext.currentMilestone,
      total_milestones: activeMilestoneContext.totalMilestones,
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

  const controllerAction = pickControllerTabOpenAction(activeMilestoneContext.baseUrl, activeTab.type, {
    milestoneUrl: currentMs?.url,
    trackId: activeTab.activeTrackId,
  });
  const kebabMenu = (
    <Menu>
      {pluginConfig.enableTwoTabController && controllerAction.createControllerUrl && (
        <Menu.Item
          label={t('docsPanel.openControllerInNewTab', 'Open in interactive window')}
          icon="external-link-alt"
          testId={testIds.docsPanel.openControllerTabButton}
          onClick={() => window.open(controllerAction.createControllerUrl!(), '_blank', 'noopener,noreferrer')}
        />
      )}
      {externalUrl && <Menu.Item label={t('docsPanel.open', 'Open')} icon="external-link-alt" onClick={handleOpen} />}
      {showReset && (
        <Menu.Item
          label={t('docsPanel.resetGuide', 'Reset guide')}
          icon="history-alt"
          testId={testIds.docsPanel.resetGuideButton}
          onClick={handleReset}
        />
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

  const isLesson = activeMilestoneContext.currentMilestone !== 0;

  return (
    <PathLessonHeader
      className={styles.milestoneProgress}
      title={currentTitle}
      progress={progress}
      showProgressBar={isLesson}
      actions={
        <>
          <Tooltip content={t('docsPanel.previousMilestoneTooltip', 'Previous milestone (Alt + ←)')} placement="top">
            <IconButton
              name={isLesson ? 'angle-left' : 'arrow-left'}
              size="md"
              aria-label={t('docsPanel.previousMilestone', 'Previous milestone')}
              onClick={handlePrev}
              disabled={!panel.canNavigatePrevious() || activeTab.isLoading}
              data-testid={testIds.docsPanel.previousMilestoneButton}
            />
          </Tooltip>
          <Tooltip content={t('docsPanel.nextMilestoneTooltip', 'Next milestone (Alt + →)')} placement="top">
            <IconButton
              name={isLesson ? 'angle-right' : 'arrow-right'}
              size="md"
              aria-label={t('docsPanel.nextMilestone', 'Next milestone')}
              onClick={handleNext}
              disabled={!panel.canNavigateNext() || activeTab.isLoading}
              data-testid={testIds.docsPanel.nextMilestoneButton}
            />
          </Tooltip>
          {!compact && (
            <Dropdown overlay={kebabMenu} placement="bottom-end">
              <IconButton
                size="md"
                name="ellipsis-v"
                tooltip={t('docsPanel.moreActions', 'More actions')}
                data-testid={testIds.docsPanel.milestoneMoreActionsButton}
              />
            </Dropdown>
          )}
        </>
      }
    />
  );
}
