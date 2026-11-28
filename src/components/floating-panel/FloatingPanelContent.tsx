import React, { useMemo, useRef } from 'react';
import { useStyles2, useTheme2 } from '@grafana/ui';
import {
  isJourneyCoverPage,
  resolveActiveMilestoneSequence,
  resolveActiveMilestoneToolbarContext,
} from '../../docs-retrieval';
import { ContentRenderer } from '../content-renderer/content-renderer';
import { GuideProgressBar } from '../guide-progress';
import { GuideReaderToolbar } from '../docs-panel/components/GuideReaderToolbar';
import { ReturnToMyLearning } from '../docs-panel/components/ReturnToMyLearning';
import { GuideLanguageSlot, TranslationNoticeSlot } from '../guide-language';
import { usePublishSurfaceContentKey } from '../../hooks';
import { InteractiveLearningBanner } from '../InteractiveLearningBanner';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getContentStyles } from '../../styles/docs-panel.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import type { RawContent } from '../../types/content.types';
import type { LearningJourneyTab, PendingAlignment } from '../../types/content-panel.types';
import {
  AlignmentPrompt,
  GuideVersionNotice,
  LearningJourneyMilestoneToolbar,
  type MilestoneToolbarSurface,
} from '../docs-panel/components';
import { AlignmentPendingContext } from '../../global-state/alignment-pending-context';
import { useLinkClickHandler } from '../docs-panel/link-handler.hook';
import type { DocsPanelModelOperations } from '../docs-panel/types';
import { getFloatingPanelStyles } from './floating-panel.styles';

interface FloatingPanelContentProps {
  hasInteractiveProgress?: boolean;
  progressKey?: string | null;
  onResetGuide?: (progressKey: string, tab: LearningJourneyTab) => Promise<void> | void;
  surface?: MilestoneToolbarSurface;
  fullPageOverview?: boolean;
  showGeneratedTitle?: boolean;
  showGuideProgress?: boolean;
  onReturnToMyLearning?: () => void;
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
   * (`loadTabContent`, milestone navigation, opening docs/journeys from
   * embedded links, etc.). Without this, content links and the
   * "Ready to Begin" CTA on the cover page have no handler.
   */
  model: DocsPanelModelOperations;
}

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
  fullPageOverview = false,
  showGeneratedTitle,
  showGuideProgress = true,
  onReturnToMyLearning,
}: FloatingPanelContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const journeyStyles = useStyles2(journeyContentHtml);
  const docsStyles = useStyles2(docsContentHtml);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);
  const floatingStyles = useStyles2(getFloatingPanelStyles);
  const readerStyles = useStyles2(getContentStyles);
  const theme = useTheme2();

  useLinkClickHandler({
    contentRef,
    activeTab,
    theme,
    model,
  });

  const alignmentIsPending = !!pendingAlignment;
  const alignmentStartingLocation = pendingAlignment?.startingLocation ?? null;
  const alignmentPendingValue = useMemo(
    () => ({
      isPending: alignmentIsPending,
      startingLocation: alignmentStartingLocation,
    }),
    [alignmentIsPending, alignmentStartingLocation]
  );

  const activeSequence = content
    ? resolveActiveMilestoneSequence(content, activeTab?.activeTrackId, activeTab?.activeTrackMilestones)
    : null;
  const completionSequence = activeSequence
    ? {
        ...activeSequence,
        baseUrl:
          (content?.type === 'learning-journey' ? content.metadata.learningJourney?.baseUrl : undefined) ??
          content?.metadata.trackMemberBaseUrl,
      }
    : undefined;

  const surfaceCompletionInput = content
    ? {
        baseUrl: activeTab?.baseUrl,
        contentUrl: content.url,
        currentUrl: activeTab?.currentUrl,
        contentType: content.type,
        metadata: content.metadata,
        guideTitle: activeTab?.title,
      }
    : null;
  usePublishSurfaceContentKey(content ? activeTab?.currentUrl || activeTab?.baseUrl : undefined);

  if (!content || !surfaceCompletionInput) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)' }}>No guide content loaded</div>
    );
  }

  const isCoverPage = isJourneyCoverPage(content);
  const showCourseOverview =
    !fullPageOverview &&
    surface === 'floating' &&
    isCoverPage &&
    Boolean(content.metadata.learningJourney?.milestones.length);
  const proseStyles = showCourseOverview
    ? readerStyles.panelCourseOverview
    : fullPageOverview && isCoverPage
      ? ''
      : content.type === 'learning-journey'
        ? journeyStyles
        : docsStyles;
  const contentClassName = `${proseStyles} ${interactiveStyles} ${prismStyles}`;

  // The active track restore's identity — see LearningJourneyTab.activeTrackPathId's
  // doc comment for why this is the manifest id, not a resolved URL.
  const contentPathId = content.metadata.packageManifest?.id;
  const coverPathId = typeof contentPathId === 'string' ? contentPathId : undefined;

  const showEmbeddedToolbar = onResetGuide !== undefined && progressKey !== undefined && activeTab !== null;
  const hasPathToolbar =
    showEmbeddedToolbar &&
    activeTab.type === 'learning-journey' &&
    !!resolveActiveMilestoneToolbarContext(content, activeTab.activeTrackId, activeTab.activeTrackMilestones);
  const showStandaloneHeader =
    showEmbeddedToolbar && surface === 'floating' && showGuideProgress && !hasPathToolbar && !isCoverPage;
  const showStandaloneProgress = showGuideProgress && !showCourseOverview && !hasPathToolbar && !showStandaloneHeader;
  const journeyToolbar = showEmbeddedToolbar && (
    <LearningJourneyMilestoneToolbar
      panel={model}
      activeTab={activeTab}
      surface={surface}
      actionsOnly={showCourseOverview}
      hasInteractiveProgress={!!hasInteractiveProgress}
      progressKey={progressKey ?? null}
      onResetGuide={onResetGuide}
    />
  );

  return (
    <AlignmentPendingContext.Provider value={alignmentPendingValue}>
      <div ref={contentRef} data-panel-course-overview={showCourseOverview || undefined}>
        {!showCourseOverview &&
          (showEmbeddedToolbar && activeTab ? (
            <div className={floatingStyles.stickyToolbar}>
              {showStandaloneHeader ? (
                <GuideReaderToolbar
                  activeTab={activeTab}
                  content={content}
                  surface="floating"
                  hasInteractiveProgress={hasInteractiveProgress}
                  progressKey={progressKey}
                  onResetGuide={onResetGuide}
                />
              ) : (
                journeyToolbar
              )}
              {showStandaloneProgress && <GuideProgressBar contentUrl={content.url} isCoverPage={isCoverPage} />}
            </div>
          ) : (
            showStandaloneProgress && (
              <div className={floatingStyles.stickyProgressBar}>
                <GuideProgressBar contentUrl={content.url} isCoverPage={isCoverPage} />
              </div>
            )
          ))}
        <div className={showCourseOverview ? readerStyles.guideNotices : undefined}>
          <GuideVersionNotice
            manifests={[activeTab?.packageInfo?.packageManifest, content?.metadata.packageManifest]}
            guideUrl={activeTab?.baseUrl || activeTab?.currentUrl}
            guideTitle={activeTab?.title}
          />
          <GuideLanguageSlot guideUrl={activeTab?.baseUrl || activeTab?.currentUrl} guideTitle={activeTab?.title} />
          <TranslationNoticeSlot guideUrl={activeTab?.baseUrl || activeTab?.currentUrl} guideTitle={activeTab?.title} />
          {pendingAlignment && onAlignmentConfirm && onAlignmentCancel && (
            <div style={showCourseOverview ? undefined : { padding: 16 }}>
              <AlignmentPrompt
                bottomSpacing={showCourseOverview ? 0 : undefined}
                startingLocation={pendingAlignment.startingLocation}
                onConfirm={onAlignmentConfirm}
                onCancel={onAlignmentCancel}
              />
            </div>
          )}
          {/* Treatment arm of the interactive-learning banner experiment; renders null
            otherwise. Covers floating and full-screen, neither of which has a
            context page to carry it. */}
          <InteractiveLearningBanner placement="guide" />
        </div>

        <ContentRenderer
          key={content.url}
          content={content}
          milestoneScrollReader={activeTab?.id}
          fullPageOverview={fullPageOverview || showCourseOverview}
          panelOverviewActions={showCourseOverview ? journeyToolbar || null : undefined}
          showGeneratedTitle={showStandaloneHeader ? false : showGeneratedTitle}
          containerRef={contentRef}
          className={contentClassName}
          completion={{ kind: 'tracked', input: surfaceCompletionInput, onComplete: onGuideComplete }}
          completionPanelEnabled
          completionSequence={completionSequence}
          onContinueToNextMilestone={
            model.canNavigateNext() ? () => model.navigateToNextMilestone({ rejectOnError: true }) : undefined
          }
          onActiveTrackChange={
            activeTab
              ? (trackId, milestones) => model.setActiveTrackId(activeTab.id, trackId, milestones, coverPathId)
              : undefined
          }
          initialActiveTrackId={activeTab?.activeTrackPathId === coverPathId ? activeTab?.activeTrackId : undefined}
        />
        {showCourseOverview && onReturnToMyLearning && (
          <ReturnToMyLearning courseOverview onReturn={onReturnToMyLearning} />
        )}
      </div>
    </AlignmentPendingContext.Provider>
  );
}
