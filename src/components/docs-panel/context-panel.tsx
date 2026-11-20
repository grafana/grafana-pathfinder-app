import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import { SceneComponentProps, SceneObjectBase } from '@grafana/scenes';
import { useStyles2 } from '@grafana/ui';
import { EnableRecommenderBanner } from '../EnableRecommenderBanner';
import { InteractiveLearningBanner } from '../InteractiveLearningBanner';
import { HelpFooter } from '../HelpFooter';
import {
  SidebarHub,
  MORE_RECOMMENDED_COUNT,
  getFirstName,
  toHubCustomGuides,
  type HubExpansion,
  type HubGuide,
  type HubSource,
} from '../SidebarHub';
import { config, locationService } from '@grafana/runtime';

// Import refactored context system
import { getStyles } from '../../styles/context-panel.styles';
import { useContextPanel, Recommendation } from '../../context-engine';
import { resolvePackageNavLinks } from '../../docs-retrieval';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  AnalyticsContentType,
} from '../../lib/analytics';
import { logger } from '../../lib/logging';
import { PLUGIN_BASE_URL } from '../../constants';
import { usePathfinderPluginConfig } from '../../hooks';
import { isDevModeEnabled } from '../../utils/dev-mode';
import { testIds } from '../../constants/testIds';
import { usePublishedGuides } from '../../utils/usePublishedGuides';
import { ContextPanelState, PackageOpenInfo } from '../../types/content-panel.types';
import { getPackageRenderType } from '../../types/package.types';
import { useRecommendationsScrollPosition } from './hooks';
import {
  useLearningPaths,
  useMyAssignments,
  selectHubResume,
  type HubLearningDeps,
  selectHubStats,
  type HubResume,
  type ResolvedAssignment,
} from '../../learning-paths';
import { learningEffort } from '../LearningContentCard/learning-effort';
import { catalogTopic } from '../../lib/catalog-discovery';

/**
 * Resolve the effective display type for a recommendation.
 * For packages, reads `manifest.type` to determine whether to display as
 * `'interactive'` (guide) or `'learning-journey'` (path/journey).
 * Non-package recommendations pass through unchanged.
 */
const getEffectiveDisplayType = (recommendation: Recommendation): Recommendation['type'] => {
  if (recommendation.type === 'package') {
    return getPackageRenderType(recommendation.manifest);
  }
  return recommendation.type;
};

/** The manifest id of a package-backed recommendation; bundled-catalogue paths have none. */
function recommendationTargetId(recommendation: Recommendation): string | undefined {
  const id = recommendation.manifest?.id;
  return typeof id === 'string' && id.trim() !== '' ? id : undefined;
}

/**
 * Matches a card to its assignment by manifest id; only a card with no id falls back to a unique title.
 * An id that matches nothing or an ambiguous title drops the badge rather than guess.
 */
function assignmentForPath(
  recommendation: Recommendation,
  assignments: ResolvedAssignment[]
): ResolvedAssignment | undefined {
  if (getEffectiveDisplayType(recommendation) !== 'learning-journey') {
    return undefined;
  }

  const targetId = recommendationTargetId(recommendation);
  if (targetId !== undefined) {
    return assignments.find((assignment) => assignment.targetId === targetId);
  }

  const title = recommendation.title.trim().toLowerCase();
  const byTitle = assignments.filter((assignment) => assignment.title.trim().toLowerCase() === title);
  return byTitle.length === 1 ? byTitle[0] : undefined;
}

const getRecommendationKind = (displayType: Recommendation['type']): 'guide' | 'path' | 'docs' =>
  displayType === 'docs-page' ? 'docs' : displayType === 'interactive' ? 'guide' : 'path';

const getRecommendationTopic = (recommendation: Recommendation, contentUrl: string): string =>
  catalogTopic({
    id: typeof recommendation.manifest?.id === 'string' ? recommendation.manifest.id : contentUrl,
    title: recommendation.title,
    category: typeof recommendation.manifest?.category === 'string' ? recommendation.manifest.category : undefined,
  });

/** Maps a recommendation's effective display type onto the canonical analytics content_type. */
const getContentTypeForDisplayType = (displayType: Recommendation['type']): AnalyticsContentType => {
  if (displayType === 'docs-page') {
    return AnalyticsContentType.Docs;
  }
  if (displayType === 'interactive') {
    return AnalyticsContentType.InteractiveGuide;
  }
  return AnalyticsContentType.LearningJourney;
};

/** Check if recommendation type is docs-only (static documentation, not action-oriented) */
const isDocsOnlyRecommendation = (type?: string): boolean => type === 'docs-page';

/**
 * Check if recommendation should use openDocsPage.
 * All packages route through openDocsPage because it handles packageInfo;
 * loadDocsTabContent sets the correct tab type based on the manifest.
 */
const shouldUseDocsPageOpener = (type?: string): boolean =>
  type === 'docs-page' || type === 'interactive' || type === 'package';

/**
 * Return the URL that should be used to open a recommendation's content.
 * Package-backed recommendations carry the content URL in contentUrl (not url,
 * which is left empty in sanitizeV1Recommendation).
 */
const getRecommendationContentUrl = (recommendation: Recommendation): string => {
  if (recommendation.type === 'package') {
    const url = recommendation.contentUrl ?? '';
    if (!url && process.env.NODE_ENV !== 'production') {
      logger.warn('[context-panel] Package recommendation missing contentUrl', { title: recommendation.title });
    }
    return url;
  }
  return recommendation.url;
};

const getRecommendationPackageInfo = (
  recommendation: Recommendation,
  trackId?: string
): PackageOpenInfo | undefined => {
  if (recommendation.type !== 'package') {
    return undefined;
  }

  const manifest = recommendation.manifest;
  const packageId =
    manifest && typeof manifest === 'object' && typeof manifest.id === 'string' ? manifest.id : undefined;

  return {
    packageId,
    packageManifest: recommendation.manifest,
    repository: recommendation.repository,
    resolvedMilestones: Array.isArray(recommendation.milestones) ? recommendation.milestones : undefined,
    ...(trackId && { trackId }),
  };
};

const HUB_MY_LEARNING_SOURCES: Record<HubSource, string> = {
  header: 'hub_header',
  assignments: 'hub_assignments',
  'in-progress': 'hub_in_progress',
  completed: 'hub_completed',
};

interface LaunchRecommendationOptions {
  interactionLocation: string;
  packageInfo: PackageOpenInfo | undefined;
  openLearningJourney: (url: string, title: string) => void;
  openDocsPage: (url: string, title: string, packageInfo?: PackageOpenInfo) => void;
}

function launchRecommendation(
  recommendation: Recommendation,
  { interactionLocation, packageInfo, openLearningJourney, openDocsPage }: LaunchRecommendationOptions
) {
  const contentUrl = getRecommendationContentUrl(recommendation);
  const displayType = getEffectiveDisplayType(recommendation);
  reportAppInteraction(UserInteraction.OpenResourceClick, {
    content_title: recommendation.title,
    content_url: contentUrl,
    content_type: getContentTypeForAnalytics(contentUrl, getContentTypeForDisplayType(displayType)),
    interaction_location: interactionLocation,
    match_accuracy: recommendation.matchAccuracy || 0,
    ...(displayType !== 'docs-page' && {
      total_milestones: recommendation.totalSteps || 0,
      completion_percentage: recommendation.completionPercentage ?? 0,
    }),
  });
  return shouldUseDocsPageOpener(recommendation.type)
    ? openDocsPage(contentUrl, recommendation.title, packageInfo)
    : openLearningJourney(contentUrl, recommendation.title);
}

function hubInteractionLocation(index: number): string {
  if (index === 0) {
    return 'hub_featured_card';
  }
  return index <= MORE_RECOMMENDED_COUNT ? 'hub_more_recommended' : 'hub_other_docs';
}

interface HubGuidesOptions {
  recommendations: Recommendation[];
  resume: Pick<HubResume, 'pathId' | 'guideUrl'> | undefined;
  assignments: ResolvedAssignment[];
  openLearningJourney: (url: string, title: string) => void;
  openDocsPage: (url: string, title: string, packageInfo?: PackageOpenInfo) => void;
  toggleSummaryExpansion: (recommendationUrl: string) => void;
}

interface HubExpansionOptions {
  recommendation: Recommendation;
  contentUrl: string;
  displayType: Recommendation['type'];
  packageInfo: PackageOpenInfo | undefined;
  featured: boolean;
  openLearningJourney: (url: string, title: string) => void;
  openDocsPage: (url: string, title: string, packageInfo?: PackageOpenInfo) => void;
  toggleSummaryExpansion: (recommendationUrl: string) => void;
}

function toHubExpansion({
  recommendation,
  contentUrl,
  displayType,
  packageInfo,
  featured,
  openLearningJourney,
  openDocsPage,
  toggleSummaryExpansion,
}: HubExpansionOptions): HubExpansion {
  const expanded = Boolean(recommendation.summaryExpanded);
  const prerequisites = recommendation.manifest?.prerequisites;
  const docsOnly = isDocsOnlyRecommendation(displayType);
  const modules = docsOnly ? [] : (recommendation.milestones ?? []);
  const hasModules = !docsOnly && (modules.length > 0 || Boolean(recommendation.pendingMilestoneIds?.length));
  return {
    expanded,
    hasModules,
    hasDetails: hasModules || (Array.isArray(prerequisites) && prerequisites.length > 0),
    prerequisites,
    modules,
    isResolving: Boolean(recommendation.isResolvingDeferred && !recommendation.milestones),
    totalSteps: recommendation.totalSteps,
    onToggle: () => {
      reportAppInteraction(UserInteraction.SummaryClick, {
        content_title: recommendation.title,
        content_url: contentUrl,
        content_type: getContentTypeForAnalytics(contentUrl, getContentTypeForDisplayType(displayType)),
        action: expanded ? 'collapse' : 'expand',
        match_accuracy: recommendation.matchAccuracy || 0,
        ...(!docsOnly && { total_milestones: recommendation.totalSteps || 0 }),
        interaction_location: featured ? 'hub_featured_card' : 'hub_more_recommended',
      });
      toggleSummaryExpansion(contentUrl);
    },
    onOpenModule: (milestone) => {
      reportAppInteraction(UserInteraction.JumpIntoMilestoneClick, {
        content_title: recommendation.title,
        milestone_title: milestone.title,
        milestone_number: milestone.number,
        milestone_url: milestone.url,
        content_url: contentUrl,
        interaction_location: featured ? 'hub_featured_milestone_list' : 'hub_milestone_list',
      });
      return packageInfo
        ? openDocsPage(milestone.url, recommendation.title, packageInfo)
        : openLearningJourney(milestone.url, `${recommendation.title} - ${milestone.title}`);
    },
  };
}

/** Keeps the engine's order; what the resume card already offers is left out. */
function toHubGuides({
  recommendations,
  resume,
  assignments,
  toggleSummaryExpansion,
  ...openers
}: HubGuidesOptions): HubGuide[] {
  const launchable = recommendations.filter((recommendation) => {
    const contentUrl = getRecommendationContentUrl(recommendation);
    return (
      contentUrl !== '' &&
      contentUrl !== resume?.guideUrl &&
      (resume === undefined || recommendationTargetId(recommendation) !== resume.pathId)
    );
  });

  return launchable.map((recommendation, index) => {
    const contentUrl = getRecommendationContentUrl(recommendation);
    const displayType = getEffectiveDisplayType(recommendation);
    const kind = getRecommendationKind(displayType);
    const packageInfo = getRecommendationPackageInfo(
      recommendation,
      assignmentForPath(recommendation, assignments)?.trackId
    );
    return {
      key: contentUrl,
      title: recommendation.title,
      summary: recommendation.summary,
      topic: getRecommendationTopic(recommendation, contentUrl),
      kind,
      effort: learningEffort(recommendation.manifest, kind),
      progress: displayType === 'docs-page' ? undefined : recommendation.completionPercentage,
      expansion: toHubExpansion({
        recommendation,
        contentUrl,
        displayType,
        packageInfo,
        featured: index === 0,
        toggleSummaryExpansion,
        ...openers,
      }),
      onLaunch: () =>
        launchRecommendation(recommendation, {
          interactionLocation: hubInteractionLocation(index),
          packageInfo,
          ...openers,
        }),
    };
  });
}

export class ContextPanel extends SceneObjectBase<ContextPanelState> {
  public static Component = ContextPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor(
    onOpenLearningJourney?: (url: string, title: string) => void,
    onOpenDocsPage?: (url: string, title: string, packageInfo?: PackageOpenInfo) => void,
    onOpenEditor?: () => void
  ) {
    super({
      onOpenLearningJourney,
      onOpenDocsPage,
      onOpenEditor,
    });
  }

  public openLearningJourney(url: string, title: string) {
    if (this.state.onOpenLearningJourney) {
      return this.state.onOpenLearningJourney(url, title);
    }
  }

  public openDocsPage(url: string, title: string, packageInfo?: PackageOpenInfo) {
    if (this.state.onOpenDocsPage) {
      return this.state.onOpenDocsPage(url, title, packageInfo);
    } else {
      logger.warn('No onOpenDocsPage callback available');
    }
  }

  public openEditor() {
    if (this.state.onOpenEditor) {
      this.state.onOpenEditor();
    }
  }

  public navigateToPath(path: string) {
    locationService.push(path);
  }
}

function ContextPanelRenderer({ model }: SceneComponentProps<ContextPanel>) {
  // Get plugin configuration with proper defaults applied
  // Resolved rather than read off `plugin.meta.jsonData`: where the
  // `PathfinderSettings` resource is authoritative, jsonData no longer receives
  // saves, so the terms gate and the dev-mode gate would both read pre-migration
  // values here.
  const { config: configWithDefaults } = usePathfinderPluginConfig();

  const devModeEnabled = isDevModeEnabled(configWithDefaults);

  // Use the simplified context hook
  const {
    contextData,
    isLoadingRecommendations,
    hasFetchedRecommendations,
    openLearningJourney,
    openDocsPage,
    toggleSummaryExpansion,
  } = useContextPanel({
    onOpenLearningJourney: model.state.onOpenLearningJourney,
    onOpenDocsPage: model.state.onOpenDocsPage,
  });
  const {
    guides: customGuides,
    paths: customGuidePaths,
    orphanGuides: customGuideOrphans,
    isLoading: isLoadingCustomGuides,
    hasLoaded: hasLoadedCustomGuides,
  } = usePublishedGuides();
  const {
    paths,
    getPathProgress,
    getPathGuides,
    isPathCompleted,
    progress,
    isLoading: isLoadingLearning,
  } = useLearningPaths();
  const {
    notDone: assignedNotDone,
    assignmentByTargetId,
    onlinePaths,
    getPathGuides: getAssignedPathGuides,
    hasLoaded: hasLoadedAssignments,
  } = useMyAssignments({
    paths,
    getPathProgress,
    getPathGuides,
    completedGuides: progress.completedGuides,
    resolveNavLinks: resolvePackageNavLinks,
  });

  // Note: Auto-open event listener moved to CombinedPanelRenderer to avoid remounting issues
  // ContextPanelRenderer remounts when tabs change, causing listener cleanup

  const { recommendations, recommendationsError } = contextData;

  const hubLearning = useMemo(() => {
    const deps: HubLearningDeps = {
      paths: [...paths, ...onlinePaths],
      assignmentByTargetId,
      getPathProgress,
      isPathCompleted,
      getPathGuides: (id, path) => getAssignedPathGuides(id, false, path),
    };
    return {
      resume: selectHubResume(deps),
      stats: selectHubStats(deps, assignedNotDone, progress.completedGuides.length),
    };
  }, [
    paths,
    onlinePaths,
    assignmentByTargetId,
    getPathProgress,
    isPathCompleted,
    getAssignedPathGuides,
    assignedNotDone,
    progress.completedGuides.length,
  ]);
  const hubGuides = useMemo(
    () =>
      toHubGuides({
        recommendations: [...contextData.featuredRecommendations, ...recommendations],
        resume: hubLearning.resume ?? undefined,
        assignments: assignedNotDone,
        openLearningJourney,
        openDocsPage,
        toggleSummaryExpansion,
      }),
    [
      contextData.featuredRecommendations,
      recommendations,
      hubLearning.resume,
      assignedNotDone,
      openLearningJourney,
      openDocsPage,
      toggleSummaryExpansion,
    ]
  );
  const hubCustomGuides = useMemo(
    () =>
      toHubCustomGuides({
        guides: customGuides,
        paths: customGuidePaths,
        orphanGuides: customGuideOrphans,
        assignments: assignedNotDone,
        openDocsPage,
      }),
    [customGuides, customGuidePaths, customGuideOrphans, assignedNotDone, openDocsPage]
  );
  const openMyLearning = useCallback((source: HubSource) => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'navigate_to_my_learning',
      source: HUB_MY_LEARNING_SOURCES[source],
    });
    locationService.push(PLUGIN_BASE_URL);
  }, []);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const resumeLearning = useCallback(
    async (resume: HubResume) => {
      const reportResume = (contentUrl: string, launchTarget: string) =>
        reportAppInteraction(UserInteraction.OpenResourceClick, {
          ...(!resume.isPrivate && { content_title: resume.pathTitle, content_url: contentUrl }),
          content_type: AnalyticsContentType.LearningJourney,
          interaction_location: 'hub_resume_card',
          completion_percentage: resume.percent,
          launch_target: launchTarget,
        });
      if (!resume.manifest || resume.pathUrl) {
        reportResume(resume.guideUrl, 'current_guide');
        return openLearningJourney(resume.guideUrl, resume.guideTitle);
      }
      // Manifest-backed paths open on their cover, like My learning; the cover resumes the current module.
      const [cover] = await resolvePackageNavLinks([resume.pathId]).catch(() => []);
      if (!mountedRef.current) {
        return;
      }
      const coverUrl = cover?.contentUrl;
      reportResume(coverUrl || resume.guideUrl, coverUrl ? 'cover_page' : 'current_guide_fallback');
      return openDocsPage(coverUrl || resume.guideUrl, resume.pathTitle, {
        packageId: resume.pathId,
        packageManifest: { ...resume.manifest, id: resume.pathId },
        ...(resume.trackId && { trackId: resume.trackId }),
      });
    },
    [openDocsPage, openLearningJourney]
  );

  const styles = useStyles2(getStyles);

  // Determine if we should show the banner
  const showEnableRecommenderBanner =
    !isLoadingRecommendations &&
    !recommendationsError &&
    !devModeEnabled &&
    recommendations.length > 0 &&
    !configWithDefaults.acceptedTermsAndConditions;

  const recommendationsScrollReady =
    !contextData.isLoading && !isLoadingRecommendations && hasFetchedRecommendations && hasLoadedCustomGuides;
  const scrollContainerRef = useRecommendationsScrollPosition(recommendationsScrollReady);

  // Signals docs-panel's panel_lcp_ms that recommendations are actually
  // showing (reuses the same readiness the scroll-position hook uses).
  // Written to scene state — a replayable observable the parent reads on
  // any render, so it survives this renderer remounting on tab changes.
  useEffect(() => {
    if (recommendationsScrollReady && !model.state.recommendationsReady) {
      model.setState({ recommendationsReady: true });
    }
  }, [recommendationsScrollReady, model]);

  return (
    <div className={styles.container} data-testid={testIds.contextPanel.container}>
      <div className={styles.content} ref={scrollContainerRef} data-testid={testIds.contextPanel.scrollContainer}>
        <div className={styles.contextSections}>
          {/* Treatment arm of the interactive-learning banner experiment; renders null otherwise */}
          <InteractiveLearningBanner />

          <SidebarHub
            userName={getFirstName(config.bootData?.user)}
            guides={hubGuides}
            customGuides={hubCustomGuides}
            isLoadingCustomGuides={isLoadingCustomGuides}
            resume={hubLearning.resume}
            stats={hubLearning.stats}
            isLoadingGuides={isLoadingRecommendations || contextData.isLoading}
            isLoadingLearning={isLoadingLearning || !hasLoadedAssignments}
            recommendationsError={recommendationsError}
            onOpenMyLearning={openMyLearning}
            onResume={resumeLearning}
          />
          {showEnableRecommenderBanner && <EnableRecommenderBanner />}
        </div>

        {/* Help Footer */}
        <HelpFooter />
      </div>
    </div>
  );
}

// Styles now imported from context-panel.styles.ts
