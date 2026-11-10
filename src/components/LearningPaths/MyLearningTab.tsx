import type { GrafanaTheme2 } from '@grafana/data';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { LinkButton, useStyles2, Icon, ConfirmModal } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import { t } from '@grafana/i18n';

import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { useLearningCardSelection } from '../LearningContentCard/useLearningCardSelection';
import { getLearningPreview } from '../LearningContentCard/learning-previews';
import { HomeLearningPathsSection, type HomePathEntry } from './sections/HomeLearningPathsSection';
import { withoutPathMembers } from '../../lib/package-catalog';
import { catalogTopic, catalogTopicShortcuts } from '../../lib/catalog-discovery';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
import { getLearningTopicMetadata } from '../LearningContentCard/learning-topic-visual';
import { getPackageBrowserStyles } from '../PackageBrowser/package-browser.styles';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';
import { useBooleanFlag } from '../../utils/openfeature';
import { openGuideInSidebar } from '../docs-panel/utils/open-prepared-guide';
import { beginGuideLoad, finishGuideLoad } from '../../lib/telemetry/guide-load';
import type { GuideLoadContext } from '../../types/guide-diagnostics.types';
import { prepareGuideLaunch, type PreparedGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { resolvePackageNavLinks } from '../../docs-retrieval';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import type { LearningPath, PathGuide } from '../../types/learning-paths.types';
import {
  catalogIdentity,
  compareResolvedAssignments,
  selectLearningPathEntries,
  useLearningPaths,
  useDiscoverMore,
  useCatalogProgress,
  selectContinueLearning,
  pathCatalogIdentities,
  useMyAssignments,
  BADGES,
  getPathsData,
  getAssignmentGuideState,
  type DiscoverMoreItem,
} from '../../learning-paths';
import { testIds } from '../../constants/testIds';
import { SkeletonLoader } from '../SkeletonLoader';
import { FeedbackButton } from '../FeedbackButton/FeedbackButton';
import { reportAppInteraction, UserInteraction, AnalyticsContentType, type ResetScope } from '../../lib/analytics';
import { logger } from '../../lib/logging';
import { normalizeTelemetryUrl } from '../../lib/telemetry';
import { StorageEvents } from '../../lib/event-names';
import {
  learningProgressStorage,
  journeyCompletionStorage,
  interactiveStepStorage,
  interactiveCompletionStorage,
  milestoneCompletionStorage,
  guideCompletionMarkStorage,
} from '../../lib/user-storage';
import { evictAllContentCaches } from '../../global-state/completion-store';
import { discardQueuedCompletionWrites, invalidateAllEmittedCompletions } from '../../completion-records';
import type { EarnedBadge } from '../../types';
import { getBadgeProgress, type BadgeProgressInfo } from './badge-utils';

import { getMyLearningStyles } from './MyLearningTab.styles';
import { BadgeDetailCard } from './BadgeDetailCard';
import { HeroStats } from './sections/HeroStats';
import { MyCoursesSection } from './sections/MyCoursesSection';
import { PrivatePathsSection } from './sections/PrivatePathsSection';
import { BadgesSection } from './sections/BadgesSection';
import { HomeBadgesSummary } from './sections/HomeBadgesSummary';
import { DiscoverMoreSection } from './sections/DiscoverMoreSection';
import { useCatalogLaunch } from './useCatalogLaunch';
import { ContinueLearningSection } from './sections/ContinueLearningSection';
import { CompletedSection } from './sections/CompletedSection';

interface MyLearningTabProps {
  homepage?: boolean;
  header?: React.ComponentType<{ children: React.ReactNode }>;
  /** Opens the prepared guide without fetching it again. */
  onOpenGuide: (launch: PreparedGuideLaunch) => void;
}

function notifyGuideLaunchError() {
  getAppEvents().publish({
    type: 'alert-error',
    payload: [
      t('myLearning.launchErrorTitle', 'Could not open the guide'),
      t('myLearning.launchErrorMessage', 'Something went wrong while loading the guide. Please try again.'),
    ],
  });
}

export function MyLearningTab({ onOpenGuide, homepage = false, header: Header }: MyLearningTabProps) {
  const getStyles = useCallback((theme: GrafanaTheme2) => getMyLearningStyles(theme, homepage), [homepage]);
  const styles = useStyles2(getStyles);
  const exploreStyles = useStyles2(getPackageBrowserStyles);
  const browseEnabled = useBooleanFlag('pathfinder.package-browser', true);
  // Guards against a second launch while the first is still fetching/classifying.
  const launchInFlightRef = useRef(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const preparingLoadRef = useRef<GuideLoadContext | undefined>(undefined);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      finishGuideLoad(preparingLoadRef.current, 'cancelled');
      preparingLoadRef.current = undefined;
    };
  }, []);
  const [selectedBadge, setSelectedBadge] = useState<EarnedBadge | null>(null);
  const [pendingAssignment, setPendingAssignment] = useState<{
    entry: HomePathEntry;
    mismatchedGuides: PathGuide[];
  } | null>(null);

  const {
    paths,
    badgesWithStatus,
    progress,
    getPathGuides: getLocalPathGuides,
    getPathProgress,
    isPathCompleted,
    getGuideUrlForPath,
    resetPath,
    resetPathGuides,
    streakInfo,
    isLoading,
  } = useLearningPaths();

  const {
    assignmentByTargetId,
    onlinePaths,
    getPathGuides,
    isLoading: assignmentsLoading,
    hasError: assignmentsError,
    retry: retryAssignments,
  } = useMyAssignments({
    paths,
    getPathProgress,
    getPathGuides: getLocalPathGuides,
    completedGuides: progress.completedGuides,
    resolveNavLinks: resolvePackageNavLinks,
  });

  // Outstanding assignments stay visible even when local progress reaches 100%.
  const inProgress = useMemo(() => {
    const local = paths.filter((path) => {
      const assignment = assignmentByTargetId.get(path.id);
      const hasOutstandingAssignment = Boolean(assignment && !assignment.satisfied);
      return hasOutstandingAssignment || getPathProgress(path.id) < 100;
    });
    const online = onlinePaths.filter((path) => !assignmentByTargetId.get(path.id)?.satisfied);
    return [...local, ...online].sort(
      (a, b) =>
        (assignmentByTargetId.get(b.id)?.progress ?? getPathProgress(b.id)) -
        (assignmentByTargetId.get(a.id)?.progress ?? getPathProgress(a.id))
    );
  }, [paths, onlinePaths, getPathProgress, assignmentByTargetId]);

  const privatePaths = useMemo(() => inProgress.filter((path) => path.isPrivate), [inProgress]);
  // Assigned private paths also appear in My paths.
  const courses = useMemo(
    () => inProgress.filter((path) => !path.isPrivate || assignmentByTargetId.get(path.id)),
    [inProgress, assignmentByTargetId]
  );

  const completedPaths = useMemo(() => {
    const local = paths.filter((path) => isPathCompleted(path.id));
    const online = onlinePaths.filter((path) => assignmentByTargetId.get(path.id)?.satisfied);
    return [...local, ...online];
  }, [paths, onlinePaths, isPathCompleted, assignmentByTargetId]);

  const excludeIdentities = useMemo(
    () => pathCatalogIdentities([...inProgress, ...completedPaths]),
    [inProgress, completedPaths]
  );
  const {
    items: discoverCandidates,
    isLoading: discoverLoading,
    catalog,
  } = useDiscoverMore({ excludeIdentities, count: Number.MAX_SAFE_INTEGER });
  const homeTopics = useMemo(() => catalogTopicShortcuts(withoutPathMembers(catalog.items)), [catalog.items]);
  const catalogProgress = useCatalogProgress(catalog.items, catalog.scope);
  const { selectedCardKey, selectCard } = useLearningCardSelection(catalog.scope);
  const allHomePathEntries = useMemo(
    () =>
      selectLearningPathEntries({
        paths,
        onlinePaths,
        assignmentByTargetId,
        catalogItems: catalog.items,
        catalogProgress,
        getPathProgress,
        getPathGuides,
        includeCompleted: true,
      }),
    [paths, onlinePaths, assignmentByTargetId, catalog.items, catalogProgress, getPathProgress, getPathGuides]
  );
  const homePathEntries = allHomePathEntries.filter(
    (entry) => entry.percent < 100 || (entry.assignment && !entry.assignment.satisfied)
  );
  const homeAssignedPaths = homePathEntries
    .filter((entry) => entry.assignment && !entry.assignment.satisfied)
    .sort((a, b) => compareResolvedAssignments(a.assignment!, b.assignment!));
  const homeAssignedKeys = new Set(homeAssignedPaths.map((entry) => entry.key));
  const homeUnassignedPaths = homePathEntries.filter((entry) => !homeAssignedKeys.has(entry.key));
  const homeContinuePaths = homeUnassignedPaths
    .filter((entry) => entry.percent > 0 && entry.percent < 100)
    .sort((a, b) => b.percent - a.percent);
  const homeContinueMemberKeys = new Set(
    homeContinuePaths.flatMap((entry) =>
      entry.guides.map((guide) => `${entry.path.isPrivate ? 'organization' : 'grafana'}:${guide.id}`)
    )
  );
  const homeContinueGuides = catalog.items
    .filter((item) => {
      const percent = catalogProgress.get(item.key)?.percent ?? 0;
      return (
        item.format === 'guide' &&
        !homeContinueMemberKeys.has(catalogIdentity(item)) &&
        Number.isFinite(percent) &&
        percent > 0 &&
        percent < 100
      );
    })
    .sort((a, b) => (catalogProgress.get(b.key)?.percent ?? 0) - (catalogProgress.get(a.key)?.percent ?? 0));
  const homeAvailablePaths = homeUnassignedPaths.filter((entry) => !(entry.percent > 0 && entry.percent < 100));
  const catalogLaunch = useCatalogLaunch(catalog.items, catalog.scope, catalogProgress, {
    launchLock: launchInFlightRef,
    loadInSidebar: homepage,
    onAcceptedLaunch: (item) => selectCard(catalogIdentity(item)),
  });
  const continueItems = useMemo(
    () =>
      selectContinueLearning(
        catalog.items,
        catalogProgress,
        homepage ? pathCatalogIdentities(completedPaths) : excludeIdentities
      ),
    [catalog.items, catalogProgress, excludeIdentities, homepage, completedPaths]
  );
  const discoverItems = useMemo(
    () => discoverCandidates.filter((item) => (catalogProgress.get(item.key ?? '')?.percent ?? 0) === 0).slice(0, 5),
    [discoverCandidates, catalogProgress]
  );

  const performLaunch = useCallback(
    async (url: string, title: string, packageInfo?: PackageOpenInfo, inSidebar = false) => {
      if (!mountedRef.current) {
        return;
      }
      if (inSidebar) {
        openGuideInSidebar({ url, title, source: 'home_page', packageInfo });
        return;
      }
      const loadContext = beginGuideLoad(url);
      preparingLoadRef.current = loadContext;
      const result = await prepareGuideLaunch(url, { title, source: 'home_page', packageInfo, loadContext });
      if (!mountedRef.current) {
        return;
      }
      preparingLoadRef.current = undefined;
      if (result.ok) {
        onOpenGuide(result.launch);
      } else {
        // Fetched error messages can contain private guide content.
        logger.error('[MyLearning] Guide launch preparation failed', {
          content_url: normalizeTelemetryUrl(url),
          error_code: result.errorCode,
        });
        notifyGuideLaunchError();
      }
    },
    [onOpenGuide]
  );

  const launch = useCallback(
    async (url: string, title: string, launchId: string, packageInfo?: PackageOpenInfo, inSidebar = false) => {
      if (launchInFlightRef.current) {
        return;
      }
      launchInFlightRef.current = true;
      setLaunchingId(launchId);
      try {
        await performLaunch(url, title, packageInfo, inSidebar);
      } finally {
        launchInFlightRef.current = false;
        if (mountedRef.current) {
          setLaunchingId(null);
        }
      }
    },
    [performLaunch]
  );

  // Lock before resolving the cover so repeated clicks cannot race the lookup.
  const openPathCover = useCallback(
    async (path: LearningPath, inSidebar = false) => {
      if (launchInFlightRef.current) {
        return;
      }
      launchInFlightRef.current = true;
      setLaunchingId(path.id);
      try {
        const packageInfo: PackageOpenInfo = {
          packageId: path.id,
          packageManifest: { ...path.manifest, id: path.id },
          trackId: assignmentByTargetId.get(path.id)?.trackId,
        };
        const [navLink] = await resolvePackageNavLinks([path.id]);
        if (!mountedRef.current) {
          return;
        }
        // A resolver miss can still open the first member guide.
        const coverUrl = navLink?.contentUrl || getGuideUrlForPath(path.guides[0] ?? '', path.id) || '';

        reportAppInteraction(UserInteraction.OpenResourceClick, {
          content_title: path.title,
          content_url: coverUrl || `package:${path.id}`,
          content_type: AnalyticsContentType.LearningJourney,
          interaction_location: 'my_learning_tab',
          launch_target: navLink?.contentUrl ? 'cover_page' : 'first_guide_fallback',
        });

        if (!coverUrl) {
          logger.error('[MyLearning] Could not resolve a cover or fallback URL for path', { path_id: path.id });
          notifyGuideLaunchError();
          return;
        }

        await performLaunch(coverUrl, path.title, packageInfo, inSidebar);
      } finally {
        launchInFlightRef.current = false;
        if (mountedRef.current) {
          setLaunchingId(null);
        }
      }
    },
    [performLaunch, getGuideUrlForPath, assignmentByTargetId]
  );

  const allPaths = useMemo(() => [...paths, ...onlinePaths], [paths, onlinePaths]);

  const handleOpenGuide = useCallback(
    (guideId: string, pathId: string, options?: { path: LearningPath; inSidebar: boolean }) => {
      if (launchInFlightRef.current) {
        return;
      }
      const parentPath = options?.path ?? allPaths.find((p) => p.id === pathId);
      const inSidebar = options?.inSidebar ?? false;

      if (parentPath?.manifest && !parentPath.url) {
        void openPathCover(parentPath, inSidebar);
        return;
      }

      if (parentPath?.url) {
        // The cover's CTA chooses the next guide from completion data.
        reportAppInteraction(UserInteraction.OpenResourceClick, {
          content_title: parentPath.title,
          content_url: parentPath.url,
          content_type: AnalyticsContentType.LearningJourney,
          interaction_location: 'my_learning_tab',
          launch_target: 'cover_page',
        });

        void launch(parentPath.url, parentPath.title, parentPath.id, undefined, inSidebar);
        return;
      }

      if (!guideId) {
        notifyGuideLaunchError();
        return;
      }

      const resolvedGuideUrl = parentPath ? getGuideUrlForPath(guideId, parentPath.id) : undefined;
      const staticGuideMetadata = getPathsData().guideMetadata[guideId];
      const title =
        (parentPath && getPathGuides(parentPath.id).find((g) => g.id === guideId)?.title) ||
        staticGuideMetadata?.title ||
        guideId;
      const guideUrl = resolvedGuideUrl ?? staticGuideMetadata?.url ?? `bundled:${guideId}`;

      reportAppInteraction(UserInteraction.OpenResourceClick, {
        content_title: title,
        content_url: guideUrl,
        content_type: AnalyticsContentType.LearningJourney,
        interaction_location: 'my_learning_tab',
      });

      if (parentPath) {
        const pathProgress = getPathProgress(parentPath.id);
        const pathGuides = getPathGuides(parentPath.id);
        const completedCount = pathGuides.filter((g) => g.completed).length;

        reportAppInteraction(UserInteraction.LearningPathProgress, {
          path_id: parentPath.id,
          path_title: parentPath.title,
          completion_percent: pathProgress,
          guides_total: parentPath.guides.length,
          guides_completed: completedCount,
        });
      }

      void launch(guideUrl, title, pathId, undefined, inSidebar);
    },
    [launch, allPaths, getPathProgress, getPathGuides, getGuideUrlForPath, openPathCover]
  );

  const openHomePath = (entry: HomePathEntry) => {
    selectCard(entry.key);
    const item = catalog.items.find(
      (candidate) => candidate.format === 'path' && catalogIdentity(candidate) === entry.key
    );
    if (
      item &&
      !paths.some((path) => path.id === entry.path.id && Boolean(path.isPrivate) === Boolean(entry.path.isPrivate)) &&
      !onlinePaths.some((path) => path.id === entry.path.id)
    ) {
      void catalogLaunch.launch(item);
    } else {
      const { effectiveGuides } = getAssignmentGuideState(entry.guides, entry.assignment?.guides);
      const nextGuide =
        effectiveGuides.find((guide) => guide.isCurrent && !guide.completed) ??
        effectiveGuides.find((guide) => !guide.completed) ??
        effectiveGuides[0];
      handleOpenGuide(nextGuide?.id ?? '', entry.path.id, { path: entry.path, inSidebar: true });
    }
  };

  const handleHomePathView = (entry: HomePathEntry) => {
    if (launchInFlightRef.current) {
      return;
    }
    const { mismatchedGuides } = getAssignmentGuideState(entry.guides, entry.assignment?.guides);
    if (mismatchedGuides.length > 0) {
      setPendingAssignment({ entry, mismatchedGuides });
      return;
    }
    openHomePath(entry);
  };

  const confirmAssignmentReset = async () => {
    if (!pendingAssignment || launchInFlightRef.current) {
      return;
    }
    launchInFlightRef.current = true;
    setLaunchingId(pendingAssignment.entry.path.id);
    let resetSucceeded = false;
    try {
      await resetPathGuides(pendingAssignment.entry.path.id, pendingAssignment.mismatchedGuides);
      resetSucceeded = true;
    } catch {
      if (mountedRef.current) {
        notifyGuideLaunchError();
      }
    } finally {
      launchInFlightRef.current = false;
      if (mountedRef.current) {
        setLaunchingId(null);
      }
    }
    if (resetSucceeded && mountedRef.current) {
      setPendingAssignment(null);
      openHomePath(pendingAssignment.entry);
    }
  };

  const handleDiscoverStart = (item: DiscoverMoreItem) => {
    const entry = item.catalogPackage ?? {
      key: item.key ?? `online-cdn:${item.id}`,
      id: item.id,
      title: item.title,
      description: item.description,
      format: 'path' as const,
      source: 'grafana' as const,
      url: item.contentUrl,
      packageInfo: item.manifest
        ? { packageId: item.id, packageManifest: { ...item.manifest, id: item.id } }
        : undefined,
    };
    return catalogLaunch.launch(entry, 'my_learning_discover_more');
  };

  const handleResetProgress = useCallback(async () => {
    if (window.confirm('Reset all learning progress? This will clear completed guides, badges, and streaks.')) {
      // Durable completion writes that are queued but not yet sent are dropped
      // first, before any await below yields: a drain scheduled before the reset
      // would otherwise fire inside that window and mint records for exactly the
      // guides the user just asked us to forget — and the dialog gives them no
      // second lever to stop it.
      discardQueuedCompletionWrites();

      reportAppInteraction(UserInteraction.ResetProgressClick, {
        reset_scope: 'all' satisfies ResetScope,
        interaction_location: 'my_learning_footer',
      });

      await learningProgressStorage.clear();

      const completions = await journeyCompletionStorage.getAll();
      for (const url of Object.keys(completions)) {
        await journeyCompletionStorage.clear(url);
      }

      // Milestone checklists outlive a per-path reset for paths that predate the
      // path-key fix, so a global reset has to drop them too — otherwise the next
      // single completion re-crosses the all-milestones threshold.
      await milestoneCompletionStorage.clearAll();

      // Clear all interactive guide step and completion state
      // This prevents guides from instantly re-completing when reopened
      await interactiveStepStorage.clearAll();
      await interactiveCompletionStorage.clearAll();
      await guideCompletionMarkStorage.clearAllWithPrefix();
      // Lifts the write-side dedupe guard for every guide, so any guide
      // re-completed after this reset emits a fresh durable record.
      invalidateAllEmittedCompletions();
      // Drop every open guide's in-memory completion snapshot too — without
      // this, currently mounted `useStepCompletion` subscribers would still
      // render the prior state until the user closed and reopened the tab.
      evictAllContentCaches();

      // Notify the context engine to refresh recommendations.
      window.dispatchEvent(
        new CustomEvent(StorageEvents.InteractiveProgressCleared, {
          detail: { contentKey: '*' },
        })
      );
    }
  }, []);

  const totalGuidesCompleted = useMemo(() => {
    if (!homepage) {
      return progress.completedGuides.length;
    }
    const completed = new Set(progress.completedGuides.map((id) => `grafana:${id}`));
    for (const item of catalog.items) {
      if (item.format === 'guide' && (catalogProgress.get(item.key)?.percent ?? 0) >= 100) {
        completed.add(catalogIdentity(item));
      }
    }
    return completed.size;
  }, [homepage, progress.completedGuides, catalog.items, catalogProgress]);
  const totalPathsCompleted = allHomePathEntries.filter((entry) => entry.percent >= 100).length;
  const totalBadgesEarned = progress.earnedBadges.length;

  const pathsForProgress = useMemo(() => paths.map((p) => ({ id: p.id, guides: p.guides })), [paths]);

  // Sort badges: earned first (most recent first), then unearned (by progress %)
  const sortedBadges = useMemo(() => {
    return [...badgesWithStatus].sort((a, b) => {
      const aEarned = !!a.earnedAt;
      const bEarned = !!b.earnedAt;

      if (aEarned !== bEarned) {
        return aEarned ? -1 : 1;
      }

      if (aEarned && bEarned) {
        return (b.earnedAt || 0) - (a.earnedAt || 0);
      }

      const baseBadgeA = BADGES.find((badge) => badge.id === a.id);
      const baseBadgeB = BADGES.find((badge) => badge.id === b.id);

      const progressA = baseBadgeA
        ? getBadgeProgress(baseBadgeA, progress.completedGuides, progress.streakDays, pathsForProgress)?.percentage || 0
        : 0;
      const progressB = baseBadgeB
        ? getBadgeProgress(baseBadgeB, progress.completedGuides, progress.streakDays, pathsForProgress)?.percentage || 0
        : 0;

      return progressB - progressA;
    });
  }, [badgesWithStatus, progress.completedGuides, progress.streakDays, pathsForProgress]);

  const homeBadgeProgress = useMemo(() => {
    const values = new Map<string, BadgeProgressInfo>();
    for (const badge of BADGES) {
      const value = getBadgeProgress(badge, progress.completedGuides, progress.streakDays, pathsForProgress);
      if (value) {
        values.set(badge.id, value);
      }
    }
    return values;
  }, [progress.completedGuides, progress.streakDays, pathsForProgress]);

  const selectedBadgeProgress = useMemo(() => {
    if (!selectedBadge) {
      return null;
    }
    const baseBadge = BADGES.find((b) => b.id === selectedBadge.id);
    if (!baseBadge) {
      return null;
    }
    if (homepage) {
      return homeBadgeProgress.get(baseBadge.id) ?? null;
    }
    return getBadgeProgress(baseBadge, progress.completedGuides, progress.streakDays, pathsForProgress);
  }, [selectedBadge, progress.completedGuides, progress.streakDays, pathsForProgress, homepage, homeBadgeProgress]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        {Header && <Header>{null}</Header>}
        <SkeletonLoader type="recommendations" />
      </div>
    );
  }

  const homeBadges = (
    <HomeBadgesSummary
      badges={sortedBadges}
      selectedBadgeId={selectedBadge?.id}
      badgeProgress={homeBadgeProgress}
      completedGuides={progress.completedGuides}
      streakDays={progress.streakDays}
      paths={pathsForProgress}
      onSelect={setSelectedBadge}
      styles={styles}
    />
  );

  const summary = (
    <HeroStats
      narrative={homepage}
      guidesCompleted={totalGuidesCompleted}
      pathsCompleted={totalPathsCompleted}
      badgesEarned={totalBadgesEarned}
      streakDays={streakInfo.days}
      styles={styles}
    />
  );

  return (
    <div className={styles.container}>
      <div className={styles.intro}>
        {Header ? <Header>{summary}</Header> : summary}

        {homepage && homeBadges}
      </div>

      {homepage && (
        <HomeLearningPathsSection
          presentation="assigned"
          title={t('myLearning.yourAssignments', 'Your assignments')}
          description={t('myLearning.assignmentsDescription', 'Guides and learning paths assigned to you.')}
          icon="user"
          entries={homeAssignedPaths}
          selectedCardKey={selectedCardKey}
          assignmentsLoading={assignmentsLoading}
          assignmentsError={assignmentsError}
          onRetryAssignments={retryAssignments}
          onView={handleHomePathView}
          styles={styles}
        />
      )}

      {!homepage && (
        <ContinueLearningSection
          items={continueItems}
          catalogItems={catalog.items}
          scope={catalog.scope}
          progress={catalogProgress}
          onContinue={catalogLaunch.launch}
          launchingKey={catalogLaunch.launchingKey}
          launchDisabled={launchingId !== null || catalogLaunch.launchingKey !== null}
          launchError={catalogLaunch.launchError}
          styles={styles}
        />
      )}
      {homepage && (
        <HomeLearningPathsSection
          presentation="continue"
          title={t('myLearning.pickUpLearning', 'Pick up where you left off')}
          description={t('myLearning.pickUpLearningDescription', 'Your guides and learning paths in progress.')}
          icon="play"
          entries={homeContinuePaths}
          selectedCardKey={selectedCardKey}
          onView={handleHomePathView}
          styles={styles}
        >
          {homeContinueGuides.map((item, index) => (
            <LearningContentCard
              key={item.key}
              tile
              selected={selectedCardKey === catalogIdentity(item) && catalogLaunch.launchError?.key !== item.key}
              presentation={homeContinuePaths.length + index === 0 ? 'resume' : 'compact'}
              title={item.title}
              description={item.description}
              kind="guide"
              preview={item.source === 'grafana' ? getLearningPreview(item.id) : undefined}
              topic={catalogTopic(item)}
              organization={item.source === 'organization'}
              progress={catalogProgress.get(item.key)?.percent}
              estimatedMinutes={item.estimatedMinutes}
              effort={
                item.activityCount !== undefined
                  ? t('packageBrowser.activities', '{{count}} activities', { count: item.activityCount })
                  : undefined
              }
              onViewPath={() => catalogLaunch.launch(item)}
              onLaunch={() => catalogLaunch.launch(item)}
              launching={catalogLaunch.launchingKey === item.key}
              launchDisabled={
                launchingId !== null || (catalogLaunch.launchingKey !== null && catalogLaunch.launchingKey !== item.key)
              }
              launchError={catalogLaunch.launchError?.key === item.key ? catalogLaunch.launchError.message : undefined}
            />
          ))}
        </HomeLearningPathsSection>
      )}

      {!homepage && (
        <PrivatePathsSection
          paths={privatePaths}
          getPathGuides={getPathGuides}
          getPathProgress={getPathProgress}
          onContinue={handleOpenGuide}
          onReset={resetPath}
          launchingPathId={launchingId}
          launchDisabled={launchingId !== null || catalogLaunch.launchingKey !== null}
          styles={styles}
        />
      )}

      <div className={styles.columnsContainer}>
        <div className={styles.columnsRow}>
          {!homepage && (
            <MyCoursesSection
              courses={courses}
              assignmentByTargetId={assignmentByTargetId}
              getPathGuides={getPathGuides}
              getPathProgress={getPathProgress}
              onContinue={handleOpenGuide}
              onReset={resetPath}
              onResetGuides={resetPathGuides}
              launchingPathId={launchingId}
              launchDisabled={launchingId !== null || catalogLaunch.launchingKey !== null}
              styles={styles}
            />
          )}
          {homepage && (
            <HomeLearningPathsSection
              title={t('myLearning.findNextPath', 'Find your next learning path')}
              description={t('myLearning.findNextPathDescription', 'Build your Grafana skills, one step at a time.')}
              icon="book-open"
              entries={homeAvailablePaths}
              selectedCardKey={selectedCardKey}
              onView={handleHomePathView}
              styles={styles}
            />
          )}

          {homepage && browseEnabled && (
            <section className={styles.openSection}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIcon}>
                  <Icon name="compass" size="lg" />
                </span>
                <div className={styles.sectionHeadingText}>
                  <h2 className={styles.sectionTitle}>
                    {t('myLearning.exploreTopics', 'What would you like to learn?')}
                  </h2>
                  <p className={styles.sectionDescription}>
                    {t('myLearning.exploreTopicsDescription', 'Browse guides and learning paths by topic.')}
                  </p>
                </div>
                <LinkButton href={`${prefixRoute(ROUTES.Browse)}?view=all`} variant="primary" size="md">
                  {t('myLearning.exploreAll', 'Explore all')} <Icon name="arrow-right" />
                </LinkButton>
              </div>
              <div className={`${exploreStyles.topics} ${exploreStyles.homeTopics}`}>
                {homeTopics.map((topic) => (
                  <a
                    key={topic.id}
                    className={exploreStyles.homeTopicCard}
                    href={`${prefixRoute(ROUTES.Browse)}?${new URLSearchParams({ topic: topic.id })}`}
                  >
                    <LearningTopicIcon topic={topic.id} size="sm" bordered />
                    <span className={exploreStyles.topicContent}>
                      <strong>{getLearningTopicMetadata(topic.id).label ?? topic.id}</strong>
                      <small>
                        {t('myLearning.topicContentCount', '{{count}} guides and learning paths', {
                          count: topic.count,
                        })}
                      </small>
                    </span>
                  </a>
                ))}
              </div>
              {catalog.loading && homeTopics.length === 0 && <SkeletonLoader type="recommendations" />}
            </section>
          )}

          {!homepage && (
            <BadgesSection
              badges={sortedBadges}
              selectedBadgeId={selectedBadge?.id}
              completedGuides={progress.completedGuides}
              streakDays={progress.streakDays}
              paths={pathsForProgress}
              onSelect={setSelectedBadge}
              styles={styles}
            />
          )}
        </div>
      </div>

      {!homepage && (
        <DiscoverMoreSection
          items={discoverItems}
          isLoading={discoverLoading}
          onStart={handleDiscoverStart}
          startingId={catalogLaunch.launchingKey}
          startDisabled={launchingId !== null || catalogLaunch.launchingKey !== null}
          catalogItems={catalog.items}
          scope={catalog.scope}
          progress={catalogProgress}
          launchError={catalogLaunch.launchError}
          styles={styles}
        />
      )}

      {!homepage && <CompletedSection completed={completedPaths} styles={styles} />}

      {/* Preview Notice - at bottom to not distract from main content */}
      <div className={styles.previewNotice}>
        <Icon name="info-circle" size="sm" />
        <span>Learning paths and badges are in preview. Content may change as we refine the experience.</span>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <FeedbackButton variant="secondary" interactionLocation="my_learning_tab_feedback" />
        <button
          className={styles.resetButton}
          onClick={handleResetProgress}
          title="Reset all learning progress (for testing)"
          data-testid={testIds.learningPaths.resetProgressButton}
        >
          Reset progress
        </button>
      </div>

      {pendingAssignment && (
        <ConfirmModal
          isOpen
          title={t('myLearning.assignmentResetTitle', 'Reset local progress?')}
          body={
            <>
              <p>
                {t(
                  'myLearning.assignmentResetBody',
                  'Starting this assignment will reset local progress on the following guide(s):'
                )}
              </p>
              <ul>
                {pendingAssignment.mismatchedGuides.map((guide) => (
                  <li key={guide.id}>{guide.title}</li>
                ))}
              </ul>
            </>
          }
          confirmText={t('myLearning.assignmentResetConfirm', 'Reset and continue')}
          dismissText={t('myLearning.assignmentResetCancel', 'Cancel')}
          onConfirm={confirmAssignmentReset}
          onDismiss={() => {
            if (!launchInFlightRef.current) {
              setPendingAssignment(null);
            }
          }}
        />
      )}
      {selectedBadge && (
        <BadgeDetailCard
          badge={selectedBadge}
          progress={selectedBadgeProgress}
          onClose={() => setSelectedBadge(null)}
        />
      )}
    </div>
  );
}
