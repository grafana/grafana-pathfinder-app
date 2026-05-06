import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SceneObjectBase, type SceneComponentProps, type SceneObjectState } from '@grafana/scenes';
import { getAppEvents, locationService } from '@grafana/runtime';
import { Icon, IconButton, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { useContentReset } from '../docs-panel/hooks';
import { cleanDocsUrl } from '../docs-panel/utils';
import { FloatingPanelContent } from '../floating-panel/FloatingPanelContent';
import { SkeletonLoader } from '../SkeletonLoader';
import { usePendingGuideLaunch, useAlignmentReevaluation } from '../../hooks';
import { panelModeManager } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { getConfigWithDefaults, PLUGIN_BASE_URL } from '../../constants';
import { reportAppInteraction, UserInteraction, getContentTypeForAnalytics } from '../../lib/analytics';
import { coerceLaunchSource } from '../../recovery';
import { findDocPage } from '../../utils/find-doc-page';
import { getJourneyProgress, getMilestoneSlug, markMilestoneDone } from '../../docs-retrieval';
import { getMilestoneStyles } from '../../styles/docs-panel.styles';
import { FullScreenLayout } from './FullScreenLayout';
import { getFullScreenStyles } from './full-screen.styles';

// Lazy-loaded so the editor only ships when the user actually opens it full screen.
const BlockEditor = lazy(() =>
  import('../block-editor').then((module) => ({
    default: module.BlockEditor,
  }))
);

const EDITOR_FULL_SCREEN_TITLE = 'Guide editor';

interface FullScreenPanelState extends SceneObjectState {}

/**
 * Scene-rooted full screen presentation of the active guide / editor.
 *
 * Sibling of the sidebar and floating panel: it owns its own
 * CombinedLearningJourneyPanel instance, restores tabs from storage on mount,
 * and consumes any handoff `pendingGuide` set by the surface that navigated
 * here. Sidebar is closed on mount so the two model instances cannot collide
 * on the __DocsPluginActiveTabId window global or on tab storage writes.
 */
export class FullScreenPanel extends SceneObjectBase<FullScreenPanelState> {
  public static Component = FullScreenPanelRenderer;
}

function FullScreenPanelRenderer(_props: SceneComponentProps<FullScreenPanel>) {
  // Polls the Pathfinder backend for MCP launch_guide handoffs.
  usePendingGuideLaunch();

  const milestoneStyles = useStyles2(getMilestoneStyles);
  const fullScreenStyles = useStyles2(getFullScreenStyles);

  const panel = useMemo(() => {
    const globalConfig = (window as any).__pathfinderPluginConfig;
    const config = getConfigWithDefaults(globalConfig || {});
    return new CombinedLearningJourneyPanel(config);
  }, []);

  // Mode + sidebar coordination: ensure mode reflects the current page and
  // the extension sidebar is closed. Idempotent — safe on refresh of
  // /fullscreen where mode may already be 'fullscreen' but a stale Grafana
  // dock could otherwise re-mount the sidebar in parallel.
  useEffect(() => {
    if (panelModeManager.getMode() !== 'fullscreen') {
      panelModeManager.setMode('fullscreen');
    } else {
      getAppEvents().publish({ type: 'close-extension-sidebar', payload: {} });
    }
  }, []);

  // Track whether a guide open is in-flight so the empty-state fallback
  // doesn't fire before the handoff or auto-launch has resolved.
  const guideOpenInFlightRef = useRef(false);

  // Handoff from sidebar/floating: open the pending guide if one was set.
  useEffect(() => {
    const handlePending = () => {
      guideOpenInFlightRef.current = true;
    };
    document.addEventListener('pathfinder-auto-launch-pending', handlePending, { once: true });

    document.dispatchEvent(new CustomEvent('pathfinder-panel-mounted', { detail: { timestamp: Date.now() } }));

    const pendingGuide = panelModeManager.consumePendingGuide();
    if (pendingGuide) {
      guideOpenInFlightRef.current = true;
      // packageInfo (e.g. from the PR tester) carries the manifest +
      // pre-resolved milestones, so openDocsPage creates a journey tab with
      // the milestone toolbar even when the URL is a raw GitHub URL that
      // openLearningJourney's package-URL detection wouldn't recognise.
      if (pendingGuide.packageInfo) {
        panel.openDocsPage(pendingGuide.url, pendingGuide.title, {
          source: 'fullscreen_handoff',
          packageInfo: pendingGuide.packageInfo,
        });
      } else if (pendingGuide.type === 'learning-journey') {
        // Preserve the original tab type. openDocsPage without packageInfo
        // creates a 'docs' tab, so calling it for a recognised journey URL
        // would strip the journey type and the milestone toolbar's gate
        // would fail.
        panel.openLearningJourney(pendingGuide.url, pendingGuide.title, { source: 'fullscreen_handoff' });
      } else {
        panel.openDocsPage(pendingGuide.url, pendingGuide.title, { source: 'fullscreen_handoff' });
      }
    }

    return () => {
      document.removeEventListener('pathfinder-auto-launch-pending', handlePending);
    };
  }, [panel]);

  // Tab restoration from storage. Mirror of the floating panel pattern:
  // restore once on mount, gated on the model still showing only the
  // default recommendations tab.
  const { tabs, activeTabId } = panel.useState();
  const [restorationDone, setRestorationDone] = useState(false);

  useEffect(() => {
    const hasOnlyDefaultTabs = tabs.length === 1 && tabs[0]?.id === 'recommendations';
    if (hasOnlyDefaultTabs) {
      panel.restoreTabsAsync().then(() => setRestorationDone(true));
    } else {
      setRestorationDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?doc=<url> URL fallback for direct navigation / refresh / shareable
  // links. Skipped if the handoff already opened a guide.
  //
  // The optional ?type= param overrides findDocPage's URL-based classification.
  // Some package URLs (e.g. interactive-learning.grafana.net/packages/<id>/content.json)
  // classify as 'interactive' even though they back a learning journey. The
  // sidebar / floating handoff always appends ?type= so reload + share preserves
  // the journey kind (and thus the milestone toolbar).
  useEffect(() => {
    if (!restorationDone || guideOpenInFlightRef.current) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const docParam = params.get('doc');
    if (!docParam) {
      return;
    }
    const docsPage = findDocPage(docParam);
    if (!docsPage) {
      return;
    }
    const typeParam = params.get('type');
    const isJourney = typeParam === 'learning-journey' || docsPage.type === 'learning-journey';
    guideOpenInFlightRef.current = true;
    if (isJourney) {
      panel.openLearningJourney(docsPage.url, docsPage.title, { source: 'url_param' });
    } else {
      panel.openDocsPage(docsPage.url, docsPage.title, { source: 'url_param' });
    }
  }, [restorationDone, panel]);

  // Listen for auto-launch-tutorial events (shared across all panel surfaces).
  useEffect(() => {
    const handleAutoLaunch = (e: CustomEvent<{ url: string; title: string; type?: string; source?: string }>) => {
      guideOpenInFlightRef.current = true;
      const { url, title, type, source } = e.detail;
      const openAsLearningJourney = type === 'learning-journey' || source === 'learning-hub';
      const typedSource = coerceLaunchSource(source) ?? undefined;
      if (openAsLearningJourney) {
        panel.openLearningJourney(url, title, { source: typedSource });
      } else {
        panel.openDocsPage(url, title, { source: typedSource });
      }
    };
    document.addEventListener('auto-launch-tutorial', handleAutoLaunch as EventListener);
    return () => {
      document.removeEventListener('auto-launch-tutorial', handleAutoLaunch as EventListener);
    };
  }, [panel]);

  // Active tab projection.
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isEditorTab = activeTab?.type === 'editor';
  const content = activeTab?.content ?? null;
  const title = isEditorTab ? EDITOR_FULL_SCREEN_TITLE : activeTab?.title || 'Interactive learning';
  const hasActiveGuide = activeTab != null && activeTab.id !== 'recommendations' && !isEditorTab;
  const guideUrl = isEditorTab ? undefined : activeTab?.baseUrl || activeTab?.currentUrl;

  // Step progress for the header counter — same window-global polling as
  // the floating panel since the interactive engine writes those globals.
  const [stepProgress, setStepProgress] = useState<string | undefined>();
  useEffect(() => {
    if (!hasActiveGuide) {
      setStepProgress(undefined);
      return;
    }
    const update = () => {
      const stepIndex = (window as any).__DocsPluginCurrentStepIndex as number | undefined;
      const totalSteps = (window as any).__DocsPluginTotalSteps as number | undefined;
      if (stepIndex !== undefined && totalSteps !== undefined && totalSteps > 0) {
        setStepProgress(`${stepIndex + 1}/${totalSteps}`);
      } else {
        setStepProgress(undefined);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [hasActiveGuide]);

  const { hasInteractiveProgress, progressKey } = useAlignmentReevaluation(panel, activeTabId, activeTab);

  const handleResetGuide = useContentReset({ model: panel });

  const handleExitToSidebar = useCallback(() => {
    reportAppInteraction(UserInteraction.FullScreenExit, {
      destination: 'sidebar',
      guide_url: guideUrl || '',
      guide_title: title,
    });
    panelModeManager.restoreSidebarTabSnapshot();
    panelModeManager.setMode('sidebar');
    sidebarState.setPendingOpenSource('fullscreen_handoff', 'open');
    sidebarState.openSidebar('Interactive learning');
    locationService.push(PLUGIN_BASE_URL);
  }, [guideUrl, title]);

  const handleSwitchToFloating = useCallback(() => {
    if (!guideUrl) {
      return;
    }
    reportAppInteraction(UserInteraction.FullScreenExit, {
      destination: 'floating',
      guide_url: guideUrl,
      guide_title: title,
    });
    // Preserve the journey tab type through the handoff so the floating
    // panel reopens it as a learning journey (with milestone navigation)
    // rather than a flat docs tab.
    const tabType = activeTab?.type === 'learning-journey' ? 'learning-journey' : 'docs';
    panelModeManager.setPendingGuide({
      url: guideUrl,
      title,
      type: tabType,
      // Preserve synthetic packageInfo (PR-tester journeys) across the
      // fullscreen → floating handoff for the same reason as the inbound
      // direction: raw GitHub URLs aren't recognised package URLs.
      packageInfo: activeTab?.packageInfo,
    });
    panelModeManager.setMode('floating');
    locationService.push(PLUGIN_BASE_URL);
  }, [guideUrl, title, activeTab?.type, activeTab?.packageInfo]);

  // Empty-state fallback: if restoration completes with nothing to show
  // and no guide is being loaded, route the user back to the sidebar so
  // they don't land on a dead full screen page.
  useEffect(() => {
    if (restorationDone && !hasActiveGuide && !isEditorTab && !guideOpenInFlightRef.current) {
      handleExitToSidebar();
    }
  }, [restorationDone, hasActiveGuide, isEditorTab, handleExitToSidebar]);

  // Symmetric counterparts to the sidebar/floating event handlers — these
  // let surface-aware components (notably the BlockEditor toolbar) ask
  // fullscreen to hand off without knowing about FullScreenPanel internals.
  useEffect(() => {
    const handleDockRequest = () => {
      handleExitToSidebar();
    };
    document.addEventListener('pathfinder-request-dock', handleDockRequest);
    return () => {
      document.removeEventListener('pathfinder-request-dock', handleDockRequest);
    };
  }, [handleExitToSidebar]);

  useEffect(() => {
    const handlePopOutRequest = () => {
      // Editor: no guideUrl — just switch the route. The editor tab is
      // already in tabStorage, so the floating panel rehydrates it.
      if (isEditorTab) {
        reportAppInteraction(UserInteraction.FullScreenExit, {
          destination: 'floating',
          guide_url: '',
          guide_title: title,
        });
        panelModeManager.setMode('floating');
        locationService.push(PLUGIN_BASE_URL);
        return;
      }
      handleSwitchToFloating();
    };
    document.addEventListener('pathfinder-request-pop-out', handlePopOutRequest);
    return () => {
      document.removeEventListener('pathfinder-request-pop-out', handlePopOutRequest);
    };
  }, [isEditorTab, handleSwitchToFloating, title]);

  // Learning-journey milestone toolbar — the same arrow-nav + actions row
  // the sidebar shows. Renders as a sub-header beneath the layout's main
  // header. Null for non-journey tabs (the editor and bundled docs render
  // without it, mirroring sidebar behavior).
  const lj = activeTab?.content?.type === 'learning-journey' ? activeTab.content.metadata.learningJourney : undefined;
  const showMilestoneProgress = activeTab?.type === 'learning-journey' && Boolean(lj);

  const journeyToolbar =
    showMilestoneProgress && activeTab && lj ? (
      <div className={milestoneStyles.milestoneProgress}>
        <div className={milestoneStyles.progressInfo}>
          <div className={milestoneStyles.progressHeader}>
            <IconButton
              name="arrow-left"
              size="sm"
              aria-label={t('docsPanel.previousMilestone', 'Previous milestone')}
              onClick={() => {
                reportAppInteraction(UserInteraction.MilestoneArrowInteractionClick, {
                  content_title: activeTab.title,
                  content_url: activeTab.baseUrl,
                  current_milestone: lj.currentMilestone || 0,
                  total_milestones: lj.totalMilestones || 0,
                  direction: 'backward',
                  interaction_location: 'milestone_progress_bar',
                  completion_percentage: activeTab.content ? getJourneyProgress(activeTab.content) : 0,
                });
                panel.navigateToPreviousMilestone();
              }}
              tooltip={t('docsPanel.previousMilestoneTooltip', 'Previous milestone (Alt + ←)')}
              tooltipPlacement="top"
              disabled={!panel.canNavigatePrevious() || activeTab.isLoading}
              className={milestoneStyles.navButton}
            />
            <span className={milestoneStyles.milestoneText}>
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
              onClick={() => {
                reportAppInteraction(UserInteraction.MilestoneArrowInteractionClick, {
                  content_title: activeTab.title,
                  content_url: activeTab.baseUrl,
                  current_milestone: lj.currentMilestone || 0,
                  total_milestones: lj.totalMilestones || 0,
                  direction: 'forward',
                  interaction_location: 'milestone_progress_bar',
                  completion_percentage: activeTab.content ? getJourneyProgress(activeTab.content) : 0,
                });
                // Mirror the sidebar: when the current milestone has no
                // interactive steps in the rendered DOM, mark it done so
                // progress advances even though there's nothing to "complete".
                if (activeTab.currentUrl && activeTab.baseUrl) {
                  const root = document.querySelector('[data-pathfinder-content="true"]');
                  const hasInteractiveSteps = (root?.querySelectorAll('[data-step-id]').length ?? 0) > 0;
                  if (!hasInteractiveSteps) {
                    const slug = getMilestoneSlug(activeTab.currentUrl);
                    if (slug) {
                      void markMilestoneDone(activeTab.baseUrl, slug, lj.totalMilestones);
                    }
                  }
                }
                panel.navigateToNextMilestone();
              }}
              tooltip={t('docsPanel.nextMilestoneTooltip', 'Next milestone (Alt + →)')}
              tooltipPlacement="top"
              disabled={!panel.canNavigateNext() || activeTab.isLoading}
              className={milestoneStyles.navButton}
            />
          </div>
          <div className={milestoneStyles.milestoneActions}>
            {(() => {
              const currentMs = lj.milestones.find((m) => m.number === (lj.currentMilestone ?? 0));
              const websiteUrl = currentMs?.websiteUrl ?? lj.websiteUrl;
              const fallbackUrl = activeTab.content?.url || activeTab.baseUrl;
              const url = websiteUrl || fallbackUrl;
              if (!url) {
                return null;
              }
              const externalUrl = cleanDocsUrl(url);
              return (
                <button
                  className={fullScreenStyles.secondaryActionButton}
                  aria-label={t('docsPanel.openInNewTab', 'Open this page in new tab')}
                  onClick={() => {
                    reportAppInteraction(UserInteraction.OpenExtraResource, {
                      content_url: externalUrl,
                      content_type: getContentTypeForAnalytics(externalUrl, activeTab.type || 'learning-journey'),
                      link_text: activeTab.title,
                      source_page: activeTab.content?.url || activeTab.baseUrl || 'unknown',
                      link_type: 'external_browser',
                      interaction_location: 'full_screen_milestone_progress_bar',
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
              );
            })()}
            {(hasInteractiveProgress || activeTab.type === 'interactive') && (
              <button
                className={fullScreenStyles.secondaryActionButton}
                aria-label={t('docsPanel.resetGuide', 'Reset guide')}
                title={t('docsPanel.resetGuideTooltip', 'Resets all interactive steps')}
                onClick={async () => {
                  if (progressKey && activeTab) {
                    await handleResetGuide(progressKey, activeTab);
                  }
                }}
              >
                <Icon name="history-alt" size="sm" />
                <span>{t('docsPanel.resetGuide', 'Reset guide')}</span>
              </button>
            )}
          </div>
          <div className={milestoneStyles.progressBar}>
            <div
              className={milestoneStyles.progressFill}
              style={{
                width: `${((lj.currentMilestone || 0) / (lj.totalMilestones || 1)) * 100}%`,
              }}
            />
          </div>
        </div>
      </div>
    ) : null;

  const guideType: 'learning-journey' | 'docs' | undefined = hasActiveGuide
    ? activeTab?.type === 'learning-journey'
      ? 'learning-journey'
      : 'docs'
    : undefined;

  return (
    <FullScreenLayout
      title={title}
      stepProgress={stepProgress}
      guideUrl={guideUrl}
      guideType={guideType}
      hasActiveGuide={hasActiveGuide}
      onExit={handleExitToSidebar}
      onGoFloating={hasActiveGuide ? handleSwitchToFloating : undefined}
      subHeader={journeyToolbar}
    >
      {isEditorTab ? (
        <Suspense fallback={<SkeletonLoader type="documentation" />}>
          <BlockEditor surface="fullscreen" />
        </Suspense>
      ) : (
        <FloatingPanelContent
          content={content}
          pendingAlignment={activeTab?.pendingAlignment}
          onAlignmentConfirm={activeTab ? () => void panel.confirmAlignment(activeTab.id) : undefined}
          onAlignmentCancel={activeTab ? () => panel.dismissAlignment(activeTab.id) : undefined}
          activeTab={activeTab ?? null}
          model={panel}
        />
      )}
    </FullScreenLayout>
  );
}
