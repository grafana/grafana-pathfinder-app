/**
 * Content area for the docs panel — the 5+ branch switch that lives below
 * the tab bar.
 *
 * Renders one of:
 *   1. FullScreenModeNotice (when the full-screen page owns the session)
 *   2. ContextPanel (the recommendations tab)
 *   3. Dev Tools (SelectorDebugPanel, lazy-loaded)
 *   4. Editor (BlockEditor, lazy-loaded)
 *   5. Loading skeleton (with milestone bar still visible for journey
 *      tabs reloading between milestones — preserves nav context)
 *   6. Error state with retry
 *   7. ContentRenderer + content meta + milestone toolbar + footer
 *
 * Behavior preserved verbatim. Lazy imports are kept INSIDE this file
 * (pre-mortem H8): the same module paths are used so webpack chunk
 * resolution remains stable.
 *
 * The wrapping `<div className={styles.content} data-testid={testIds.docsPanel.content}>`
 * is the outer surface. testIds.docsPanel.content moves with this component
 * — SOURCE_CONTRACT in docs-panel.contract.test.tsx is updated in the same
 * commit.
 */
import React, { Suspense, lazy } from 'react';
import { Button, Icon, IconButton } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { PLUGIN_BASE_URL } from '../../../constants';
import { testIds } from '../../../constants/testIds';
import type { LearningJourneyTab, PackageOpenInfo, ContextPanelState } from '../../../types/content-panel.types';
import type { getStyles as getDocsPanelStyles } from '../../../styles/docs-panel.styles';
import { isDocsLikeTab, pickGrafanaDocsOpenAction } from '../utils';
import { reportAppInteraction, UserInteraction, getContentTypeForAnalytics } from '../../../lib/analytics';
import { getMilestoneSlug, markMilestoneDone, setJourneyCompletionPercentage } from '../../../docs-retrieval';
import { ContentRenderer } from '../../content-renderer/content-renderer';
import { AlignmentPendingContext } from '../../../global-state/alignment-pending-context';
import { SkeletonLoader } from '../../SkeletonLoader';
import { AlignmentPrompt } from './AlignmentPrompt';
import { ErrorDisplay } from './ErrorDisplay';
import { FullScreenModeNotice } from './FullScreenModeNotice';
import { LoadingIndicator } from './LoadingIndicator';
import { LearningJourneyMilestoneToolbar } from './LearningJourneyMilestoneToolbar';
import { PanelModeActionButtons } from './PanelModeActionButtons';
import { DocsPanelHeaderMenu } from './DocsPanelHeaderMenu';
import type { SceneObject } from '@grafana/scenes';
import type { OpenDocsOptions } from '../types';
import type { CombinedLearningJourneyPanel } from '../docs-panel';

// Kept inside the component file so webpack sees the same dynamic-import
// module specifiers used pre-refactor. See pre-mortem H8.
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

  model: CombinedLearningJourneyPanel;
  contextPanel: SceneObject<ContextPanelState>;

  isFullScreenActive: boolean;
  isRecommendationsTab: boolean;
  isEditorUser: boolean;
  isDevMode: boolean;
  isWysiwygPreview: boolean;

  activeTabId: string;
  activeTab: LearningJourneyTab | null;
  stableContent: LearningJourneyTab['content'] | undefined;

  hasInteractiveProgress: boolean;
  progressKey: string | null;
  alignmentPendingValue: { isPending: boolean; startingLocation: string | null };

  contentRef: React.RefObject<HTMLDivElement>;
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
    activeTabId,
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

  return (
    <div className={styles.content} data-testid={testIds.docsPanel.content}>
      {(() => {
        if (isFullScreenActive) {
          return <FullScreenModeNotice />;
        }

        if (isRecommendationsTab) {
          return <contextPanel.Component model={contextPanel} />;
        }

        if (activeTabId === 'devtools') {
          return (
            <div className={styles.devToolsContent} data-testid="devtools-tab-content">
              <Suspense fallback={<SkeletonLoader type="recommendations" />}>
                <SelectorDebugPanel
                  onOpenDocsPage={(url: string, title: string, packageInfo?: PackageOpenInfo) => {
                    const opts: OpenDocsOptions = {
                      source: 'devtools',
                      skipReadyToBegin: true,
                      packageInfo,
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

        if (activeTabId === 'editor' && isEditorUser) {
          return (
            <div className={styles.devToolsContent} data-testid="editor-tab-content">
              <Suspense fallback={<SkeletonLoader type="recommendations" />}>
                <BlockEditor />
              </Suspense>
            </div>
          );
        }

        if (!isRecommendationsTab && activeTab?.isLoading) {
          const ljMeta = activeTab.content?.metadata?.learningJourney;
          const showBarWhileLoading =
            ljMeta &&
            activeTab.content?.type === 'learning-journey' &&
            (activeTab.type === 'learning-journey' || !isDocsLikeTab(activeTab.type));

          return (
            <div className={isDocsLikeTab(activeTab.type) ? styles.docsContent : styles.journeyContent}>
              {showBarWhileLoading && (
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
                        {ljMeta.currentMilestone === 0
                          ? t('docsPanel.milestoneIntroduction', 'Introduction ({{total}} milestones)', {
                              total: ljMeta.totalMilestones,
                            })
                          : t('docsPanel.milestoneProgress', 'Milestone {{current}} of {{total}}', {
                              current: ljMeta.currentMilestone,
                              total: ljMeta.totalMilestones,
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
                          width: `${((ljMeta.currentMilestone || 0) / (ljMeta.totalMilestones || 1)) * 100}%`,
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

        if (!isRecommendationsTab && activeTab?.error && !activeTab.isLoading) {
          return (
            <ErrorDisplay
              className={isDocsLikeTab(activeTab.type) ? styles.docsContent : styles.journeyContent}
              contentType={isDocsLikeTab(activeTab.type) ? 'documentation' : 'learning-journey'}
              error={activeTab.error}
              onRetry={() => reloadActiveTab(activeTab)}
            />
          );
        }

        if (!isRecommendationsTab && activeTab?.content && !activeTab.isLoading) {
          const isLearningJourneyTab = activeTab.type === 'learning-journey' || !isDocsLikeTab(activeTab.type);
          const showMilestoneProgress =
            isLearningJourneyTab &&
            activeTab.content?.type === 'learning-journey' &&
            activeTab.content.metadata.learningJourney;

          return (
            <div className={isDocsLikeTab(activeTab.type) ? styles.docsContent : styles.journeyContent}>
              {/* Return to Editor Banner - only shown for WYSIWYG preview */}
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

              {/* Content Meta for learning path pages (when no milestone progress is shown) */}
              {isLearningJourneyTab && !showMilestoneProgress && (
                <div className={styles.contentMeta}>
                  <div className={styles.metaInfo}>
                    <span>{t('docsPanel.learningJourney', 'Learning path')}</span>
                  </div>
                  <small>
                    {(activeTab.content?.metadata.learningJourney?.totalMilestones || 0) > 0
                      ? t('docsPanel.milestonesCount', '{{count}} milestones', {
                          count: activeTab.content?.metadata.learningJourney?.totalMilestones,
                        })
                      : t('docsPanel.interactiveJourney', 'Interactive journey')}
                  </small>
                </div>
              )}

              {/* Content Meta for docs/interactive - label left, primary actions + kebab right */}
              {isDocsLikeTab(activeTab.type) && (
                <div className={styles.contentMeta}>
                  <div className={styles.metaInfo}>
                    <span>
                      {activeTab.type === 'interactive'
                        ? t('docsPanel.interactiveGuide', 'Interactive guide')
                        : t('docsPanel.documentation', 'Documentation')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                              content_type: getContentTypeForAnalytics(cleanUrl, activeTab.type || 'docs'),
                              link_text: activeTab.title,
                              source_page: activeTab.content?.url || activeTab.baseUrl || 'unknown',
                              link_type: 'external_browser',
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
                    {(hasInteractiveProgress || activeTab.type === 'interactive') && (
                      <button
                        className={styles.secondaryActionButton}
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
                    <PanelModeActionButtons className={styles.secondaryActionButton} />
                    <DocsPanelHeaderMenu
                      activeTab={activeTab}
                      isDevMode={isDevMode}
                      onReload={reloadActiveTab}
                      interactionLocation="docs_panel_header_feedback_menu"
                      defaultContentType="docs"
                    />
                  </div>
                </div>
              )}

              {/* Milestone Progress - shared with the fullscreen surface via
                  LearningJourneyMilestoneToolbar. Returns null for non-journey
                  tabs so the consumer can render unconditionally. */}
              <LearningJourneyMilestoneToolbar
                panel={model}
                activeTab={activeTab}
                surface="sidebar"
                contentRoot={contentRef}
                actionButtonClassName={styles.secondaryActionButton}
                hasInteractiveProgress={hasInteractiveProgress}
                progressKey={progressKey}
                onResetGuide={handleResetGuide}
                trailingActions={
                  <>
                    <PanelModeActionButtons className={styles.secondaryActionButton} />
                    <DocsPanelHeaderMenu
                      activeTab={activeTab}
                      isDevMode={isDevMode}
                      onReload={reloadActiveTab}
                      interactionLocation="milestone_progress_bar_feedback_menu"
                      defaultContentType="learning-journey"
                    />
                  </>
                }
              />

              {/* Unified Content Renderer - works for both learning journeys and docs! */}
              <div id="inner-docs-content" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {stableContent && (
                  <AlignmentPendingContext.Provider value={alignmentPendingValue}>
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
                      onGuideComplete={() => {
                        const baseUrl = activeTab?.baseUrl || stableContent.url;
                        if (baseUrl?.startsWith('bundled:')) {
                          setJourneyCompletionPercentage(baseUrl, 100);
                        }
                        if (stableContent.type === 'learning-journey' && activeTab?.currentUrl) {
                          const slug = getMilestoneSlug(activeTab.currentUrl);
                          const journeyBase = activeTab.baseUrl;
                          if (slug && journeyBase) {
                            markMilestoneDone(
                              journeyBase,
                              slug,
                              stableContent.metadata?.learningJourney?.totalMilestones
                            );
                          }
                        }
                      }}
                    />
                  </AlignmentPendingContext.Provider>
                )}

                {/* Go home button - always visible at bottom of content */}
                <div className={styles.contentFooterAction}>
                  <Button
                    variant="secondary"
                    icon="book-open"
                    size="md"
                    onClick={() => {
                      window.location.assign(PLUGIN_BASE_URL);
                    }}
                  >
                    {t('docsPanel.returnToMyLearning', 'Return to my learning')}
                  </Button>
                </div>
              </div>
            </div>
          );
        }

        return null;
      })()}
    </div>
  );
}
