import { usePathfinderPluginConfig } from '../../../hooks';
import { useBooleanFlag } from '../../../utils/openfeature';
import { openGuideInSidebar } from '../utils/open-prepared-guide';
import React, { Suspense, lazy, useSyncExternalStore } from 'react';
import { Button, Icon, IconButton } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { testIds } from '../../../constants/testIds';
import type { LearningJourneyTab, PackageOpenInfo, ContextPanelState } from '../../../types/content-panel.types';
import type { getStyles as getDocsPanelStyles } from '../../../styles/docs-panel.styles';
import {
  isDocsLikeTab,
  pickGrafanaDocsOpenAction,
  pickControllerTabOpenAction,
  RECOMMENDATIONS_TAB_ID,
} from '../utils';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  tabTypeToContentType,
  AnalyticsLinkType,
} from '../../../lib/analytics';
import {
  journeyProgressFromMilestones,
  resolveActiveMilestoneToolbarContext,
  resolveActiveMilestoneSequence,
} from '../../../docs-retrieval';
import { getGuideProgressRevision, subscribeGuideProgressRevision } from '../../../global-state/progress-events';
import { ContentRenderer } from '../../content-renderer/content-renderer';
import { InteractiveLearningBanner } from '../../InteractiveLearningBanner';
import { AlignmentPendingContext } from '../../../global-state/alignment-pending-context';
import { SkeletonLoader } from '../../SkeletonLoader';
import { MyLearningErrorBoundary } from './MyLearningErrorBoundary';
import { AlignmentPrompt } from './AlignmentPrompt';
import { GuideVersionNotice } from './GuideVersionNotice';
import { ErrorDisplay } from './ErrorDisplay';
import { FullScreenModeNotice } from './FullScreenModeNotice';
import { LoadingIndicator } from './LoadingIndicator';
import { LearningJourneyMilestoneToolbar } from './LearningJourneyMilestoneToolbar';
import { PanelModeActionButtons } from './PanelModeActionButtons';
import type { SceneObject } from '@grafana/scenes';
import type { DocsPanelModelOperations, OpenDocsOptions } from '../types';

const PackageBrowser = lazy(() =>
  import('../../PackageBrowser/PackageBrowser').then((module) => ({ default: module.PackageBrowser }))
);

const SelectorDebugPanel = lazy(() =>
  import('../../SelectorDebugPanel').then((module) => ({
    default: module.SelectorDebugPanel,
  }))
);

const BlockEditor = lazy(() =>
  import('../../block-editor').then((module) => ({
    default: module.BlockEditor,
  }))
);

type DocsPanelStyles = ReturnType<typeof getDocsPanelStyles>;

export interface DocsPanelContentAreaProps {
  styles: DocsPanelStyles;
  journeyStyles: string;
  docsStyles: string;
  interactiveStyles: string;
  prismStyles: string;

  model: DocsPanelModelOperations;
  contextPanel: SceneObject<ContextPanelState>;

  isFullScreenActive: boolean;
  isRecommendationsTab: boolean;
  isEditorUser: boolean;
  isDevMode: boolean;
  isWysiwygPreview: boolean;

  activeTab: LearningJourneyTab | null;
  stableContent: LearningJourneyTab['content'] | undefined;

  hasInteractiveProgress: boolean;
  progressKey: string | null;
  alignmentPendingValue: { isPending: boolean; startingLocation: string | null };

  contentRef: React.RefObject<HTMLDivElement | null>;
  handleResetGuide: (progressKey: string, activeTab: LearningJourneyTab) => Promise<void>;
  reloadActiveTab: (tab: LearningJourneyTab) => void;
  restoreScrollPosition: () => void;
}

export function DocsPanelContentArea(props: DocsPanelContentAreaProps): React.ReactElement {
  const {
    styles,
    journeyStyles,
    docsStyles,
    interactiveStyles,
    prismStyles,
    model,
    contextPanel,
    isFullScreenActive,
    isRecommendationsTab,
    isEditorUser,
    isDevMode,
    isWysiwygPreview,
    activeTab,
    stableContent,
    hasInteractiveProgress,
    progressKey,
    alignmentPendingValue,
    contentRef,
    handleResetGuide,
    reloadActiveTab,
    restoreScrollPosition,
  } = props;

  const { config: pluginConfig } = usePathfinderPluginConfig();
  const twoTabControllerEnabled = pluginConfig.enableTwoTabController;
  const completionPanelEnabled = useBooleanFlag('pathfinder.completion-panel', true);
  const browseEnabled = useBooleanFlag('pathfinder.package-browser', true);

  // A restored track must belong to this cover's manifest ID.
  const stableContentPathId = stableContent?.metadata.packageManifest?.id;
  const activeCoverPathId = typeof stableContentPathId === 'string' ? stableContentPathId : undefined;

  const handleGuideTitleChange = React.useCallback((title: string) => model.updateEditorTabTitle(title), [model]);

  // The loading toolbar also needs fresh completion evidence.
  useSyncExternalStore(subscribeGuideProgressRevision, getGuideProgressRevision, getGuideProgressRevision);

  const activeSequence = stableContent
    ? resolveActiveMilestoneSequence(stableContent, activeTab?.activeTrackId, activeTab?.activeTrackMilestones)
    : null;
  const completionSequence = activeSequence
    ? {
        ...activeSequence,
        baseUrl:
          (stableContent?.type === 'learning-journey' ? stableContent.metadata.learningJourney?.baseUrl : undefined) ??
          stableContent?.metadata.trackMemberBaseUrl,
      }
    : undefined;

  const surfaceCompletionInput = stableContent
    ? {
        baseUrl: activeTab?.baseUrl,
        contentUrl: stableContent.url,
        currentUrl: activeTab?.currentUrl,
        contentType: stableContent.type,
        metadata: stableContent.metadata,
        guideTitle: activeTab?.title,
      }
    : null;

  return (
    <div className={styles.content} data-testid={testIds.docsPanel.content}>
      {(() => {
        if (isFullScreenActive) {
          return <FullScreenModeNotice />;
        }

        if (activeTab?.type === 'browse' && browseEnabled) {
          return (
            <MyLearningErrorBoundary
              fallbackMessage={t('packageBrowser.renderError', 'Unable to load the guide browser')}
            >
              <Suspense fallback={<SkeletonLoader type="recommendations" />}>
                <PackageBrowser onOpenGuide={openGuideInSidebar} />
              </Suspense>
            </MyLearningErrorBoundary>
          );
        }
        if (activeTab?.type === 'browse') {
          return <contextPanel.Component model={contextPanel} />;
        }
        if (isRecommendationsTab) {
          return <contextPanel.Component model={contextPanel} />;
        }

        // Enforce authorization at the render boundary as well as in model state.
        if (activeTab?.type === 'devtools' && isDevMode) {
          return (
            <div className={styles.devToolsContent} data-testid="devtools-tab-content">
              <Suspense fallback={<SkeletonLoader type="recommendations" />}>
                <SelectorDebugPanel
                  onOpenDocsPage={(url: string, title: string, packageInfo?: PackageOpenInfo) => {
                    const manifestId = packageInfo?.packageManifest?.id;
                    const opts: OpenDocsOptions = {
                      source: 'devtools',
                      skipReadyToBegin: true,
                      packageInfo,
                      // Dev tools open covers, so the explicit identity is the manifest ID.
                      explicitGuideId: typeof manifestId === 'string' ? manifestId : undefined,
                    };
                    return model.openDocsPage(url, title, opts);
                  }}
                  onOpenLearningJourney={(url: string, title: string) => {
                    return model.openLearningJourney(url, title, { source: 'devtools' });
                  }}
                />
              </Suspense>
            </div>
          );
        }

        if (activeTab?.type === 'editor' && isEditorUser) {
          return (
            <div className={styles.devToolsContent} data-testid="editor-tab-content">
              <Suspense fallback={<SkeletonLoader type="recommendations" />}>
                <BlockEditor onGuideTitleChange={handleGuideTitleChange} />
              </Suspense>
            </div>
          );
        }

        if (activeTab?.type === 'devtools' || activeTab?.type === 'editor') {
          return <contextPanel.Component model={contextPanel} />;
        }

        if (activeTab?.isLoading) {
          const loadingActiveContext = activeTab.content
            ? resolveActiveMilestoneToolbarContext(
                activeTab.content,
                activeTab.activeTrackId,
                activeTab.activeTrackMilestones
              )
            : null;
          const showBarWhileLoading =
            Boolean(loadingActiveContext) &&
            activeTab.content?.type === 'learning-journey' &&
            (activeTab.type === 'learning-journey' || !isDocsLikeTab(activeTab.type));

          return (
            <div className={isDocsLikeTab(activeTab.type) ? styles.docsContent : styles.journeyContent}>
              {showBarWhileLoading && loadingActiveContext && (
                <div className={styles.milestoneProgress}>
                  <div className={styles.progressInfo}>
                    <div className={styles.progressHeader}>
                      <IconButton
                        name="arrow-left"
                        size="sm"
                        aria-label={t('docsPanel.previousMilestone', 'Previous milestone')}
                        onClick={() => model.navigateToPreviousMilestone()}
                        tooltip={t('docsPanel.previousMilestoneTooltip', 'Previous milestone (Alt + ←)')}
                        tooltipPlacement="top"
                        disabled={true}
                        className={styles.navButton}
                      />
                      <span className={styles.milestoneText}>
                        {loadingActiveContext.currentMilestone === 0
                          ? t('docsPanel.milestoneIntroduction', 'Introduction ({{total}} milestones)', {
                              total: loadingActiveContext.totalMilestones,
                            })
                          : t('docsPanel.milestoneProgress', 'Milestone {{current}} of {{total}}', {
                              current: loadingActiveContext.currentMilestone,
                              total: loadingActiveContext.totalMilestones,
                            })}
                      </span>
                      <IconButton
                        name="arrow-right"
                        size="sm"
                        aria-label={t('docsPanel.nextMilestone', 'Next milestone')}
                        onClick={() => model.navigateToNextMilestone()}
                        tooltip={t('docsPanel.nextMilestoneTooltip', 'Next milestone (Alt + →)')}
                        tooltipPlacement="top"
                        disabled={true}
                        className={styles.navButton}
                      />
                    </div>
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressFill}
                        style={{
                          // Completion evidence, rather than navigation, controls the fill.
                          width: `${journeyProgressFromMilestones(loadingActiveContext.baseUrl, loadingActiveContext.milestones)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <LoadingIndicator contentType={isDocsLikeTab(activeTab.type) ? 'documentation' : 'learning-journey'} />
            </div>
          );
        }

        if (activeTab?.error && !activeTab.isLoading) {
          return (
            <ErrorDisplay
              className={isDocsLikeTab(activeTab.type) ? styles.docsContent : styles.journeyContent}
              contentType={isDocsLikeTab(activeTab.type) ? 'documentation' : 'learning-journey'}
              error={activeTab.error}
              onRetry={() => reloadActiveTab(activeTab)}
            />
          );
        }

        if (activeTab?.content && !activeTab.isLoading) {
          const isLearningJourneyTab = activeTab.type === 'learning-journey' || !isDocsLikeTab(activeTab.type);
          // Keep the metadata row and milestone toolbar mutually exclusive.
          const showMilestoneProgress =
            isLearningJourneyTab &&
            activeTab.content?.type === 'learning-journey' &&
            Boolean(
              resolveActiveMilestoneToolbarContext(
                activeTab.content,
                activeTab.activeTrackId,
                activeTab.activeTrackMilestones
              )
            );

          return (
            <div className={isDocsLikeTab(activeTab.type) ? styles.docsContent : styles.journeyContent}>
              {isWysiwygPreview && (
                <div className={styles.returnToEditorBanner} data-testid={testIds.devTools.previewBanner}>
                  <div className={styles.returnToEditorLeft} data-testid={testIds.devTools.previewModeIndicator}>
                    <Icon name="eye" size="sm" />
                    <span>{t('docsPanel.previewMode', 'Preview mode')}</span>
                  </div>
                  <button
                    className={styles.returnToEditorButton}
                    onClick={() => model.openEditorTab()}
                    data-testid={testIds.devTools.returnToEditorButton}
                  >
                    <Icon name="arrow-left" size="sm" />
                    {t('docsPanel.returnToEditor', 'Return to editor')}
                  </button>
                </div>
              )}
              {isLearningJourneyTab && !showMilestoneProgress && (
                <div className={styles.contentMeta}>
                  <div className={styles.metaInfo}>
                    <small>
                      {(activeTab.content?.metadata.learningJourney?.totalMilestones || 0) > 0
                        ? t('docsPanel.milestonesCount', '{{count}} milestones', {
                            count: activeTab.content?.metadata.learningJourney?.totalMilestones,
                          })
                        : t('docsPanel.interactiveJourney', 'Interactive journey')}
                    </small>
                  </div>
                </div>
              )}
              {isDocsLikeTab(activeTab.type) && (
                <div className={styles.contentMeta}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                    {(() => {
                      const action = pickGrafanaDocsOpenAction(activeTab.content?.url || activeTab.baseUrl);
                      if (!action.shouldShow || !action.cleanUrl) {
                        return null;
                      }
                      const cleanUrl = action.cleanUrl;
                      return (
                        <button
                          className={styles.secondaryActionButton}
                          aria-label={t('docsPanel.openInNewTab', 'Open this page in new tab')}
                          onClick={() => {
                            reportAppInteraction(UserInteraction.OpenExtraResource, {
                              content_url: cleanUrl,
                              content_type: getContentTypeForAnalytics(cleanUrl, tabTypeToContentType(activeTab.type)),
                              link_text: activeTab.title,
                              source_page: activeTab.content?.url || activeTab.baseUrl || 'unknown',
                              link_type: AnalyticsLinkType.ExternalBrowser,
                              interaction_location: 'docs_content_meta_right',
                            });
                            setTimeout(() => {
                              window.open(cleanUrl, '_blank', 'noopener,noreferrer');
                            }, 100);
                          }}
                        >
                          <Icon name="external-link-alt" size="sm" />
                          <span>{t('docsPanel.open', 'Open')}</span>
                        </button>
                      );
                    })()}
                    {(() => {
                      if (!twoTabControllerEnabled) {
                        return null;
                      }
                      const guideUrl = activeTab.content?.url || activeTab.baseUrl;
                      const action = pickControllerTabOpenAction(guideUrl, activeTab.type);
                      if (!action.shouldShow || !action.createControllerUrl) {
                        return null;
                      }
                      const createControllerUrl = action.createControllerUrl;
                      return (
                        <button
                          className={styles.secondaryActionButton}
                          aria-label={t('docsPanel.openControllerInNewTab', 'Open in interactive window')}
                          title={t('docsPanel.openControllerInNewTab', 'Open in interactive window')}
                          data-testid={testIds.docsPanel.openControllerTabButton}
                          onClick={() => {
                            reportAppInteraction(UserInteraction.OpenExtraResource, {
                              content_url: guideUrl || 'unknown',
                              content_type: getContentTypeForAnalytics(guideUrl, tabTypeToContentType(activeTab.type)),
                              link_text: activeTab.title,
                              source_page: activeTab.content?.url || activeTab.baseUrl || 'unknown',
                              link_type: AnalyticsLinkType.ExternalBrowser,
                              interaction_location: 'docs_content_meta_right',
                            });
                            const controllerUrl = createControllerUrl();
                            window.open(controllerUrl, '_blank', 'noopener,noreferrer');
                          }}
                        >
                          <Icon name="external-link-alt" size="sm" />
                          <span>{t('docsPanel.open', 'Open')}</span>
                        </button>
                      );
                    })()}
                    {(hasInteractiveProgress || activeTab.type === 'interactive') && (
                      <button
                        className={styles.secondaryActionButton}
                        aria-label={t('docsPanel.resetGuide', 'Reset guide')}
                        title={t('docsPanel.resetGuideTooltip', 'Resets all interactive steps')}
                        data-testid={testIds.docsPanel.resetGuideButton}
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
                    <PanelModeActionButtons className={styles.secondaryActionButton} />
                  </div>
                </div>
              )}
              <LearningJourneyMilestoneToolbar
                panel={model}
                activeTab={activeTab}
                surface="sidebar"
                hasInteractiveProgress={hasInteractiveProgress}
                progressKey={progressKey}
                onResetGuide={handleResetGuide}
              />
              <div id="inner-docs-content" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {stableContent && surfaceCompletionInput && (
                  <AlignmentPendingContext.Provider value={alignmentPendingValue}>
                    <GuideVersionNotice
                      manifests={[activeTab?.packageInfo?.packageManifest, stableContent.metadata.packageManifest]}
                      guideUrl={activeTab?.baseUrl || activeTab?.currentUrl}
                      guideTitle={activeTab?.title}
                    />
                    {activeTab?.pendingAlignment && (
                      <AlignmentPrompt
                        startingLocation={activeTab.pendingAlignment.startingLocation}
                        onConfirm={() => {
                          void model.confirmAlignment(activeTab.id);
                        }}
                        onCancel={() => {
                          model.dismissAlignment(activeTab.id);
                        }}
                      />
                    )}
                    <InteractiveLearningBanner placement="guide" />

                    <ContentRenderer
                      key={activeTab?.currentUrl || stableContent.url}
                      content={stableContent}
                      containerRef={contentRef}
                      className={`${
                        stableContent.type === 'learning-journey' ? journeyStyles : docsStyles
                      } ${interactiveStyles} ${prismStyles}`}
                      onContentReady={() => {
                        restoreScrollPosition();
                      }}
                      completion={{ kind: 'tracked', input: surfaceCompletionInput }}
                      completionPanelEnabled={completionPanelEnabled}
                      completionSequence={completionSequence}
                      onContinueToNextMilestone={
                        model.canNavigateNext() ? () => model.navigateToNextMilestone() : undefined
                      }
                      onActiveTrackChange={
                        activeTab
                          ? (trackId, milestones) =>
                              model.setActiveTrackId(activeTab.id, trackId, milestones, activeCoverPathId)
                          : undefined
                      }
                      initialActiveTrackId={
                        activeTab?.activeTrackPathId === activeCoverPathId ? activeTab?.activeTrackId : undefined
                      }
                    />
                  </AlignmentPendingContext.Provider>
                )}

                {!completionPanelEnabled && (
                  <div className={styles.contentFooterAction}>
                    <Button
                      variant="secondary"
                      icon="book-open"
                      size="md"
                      onClick={() => {
                        reportAppInteraction(UserInteraction.DocsPanelInteraction, {
                          action: 'navigate_to_recommendations',
                          source: 'content_footer',
                        });
                        model.setActiveTab(RECOMMENDATIONS_TAB_ID);
                      }}
                    >
                      {t('docsPanel.myLearning', 'My learning')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        }

        return null;
      })()}
    </div>
  );
}
