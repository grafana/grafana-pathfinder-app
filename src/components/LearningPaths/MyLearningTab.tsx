import type { GrafanaTheme2 } from '@grafana/data';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { LinkButton, useStyles2, Icon } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import { t } from '@grafana/i18n';

import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { HomeLearningPathsSection, type HomePathEntry } from './sections/HomeLearningPathsSection';
import { withoutPathMembers } from '../../lib/package-catalog';
import { catalogTopic, catalogTopicShortcuts } from '../../lib/catalog-discovery';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
import { getLearningTopicMetadata } from '../LearningContentCard/learning-topic-visual';
import { getPackageBrowserStyles } from '../PackageBrowser/package-browser.styles';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';
import { openGuideInSidebar } from '../docs-panel/utils/open-prepared-guide';
import { beginGuideLoad, finishGuideLoad } from '../../lib/telemetry/guide-load';
import type { GuideLoadContext } from '../../types/guide-diagnostics.types';
import { prepareGuideLaunch, type PreparedGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { resolvePackageNavLinks } from '../../docs-retrieval';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import type { LearningPath } from '../../types/learning-paths.types';
import {
  catalogIdentity,
  selectLearningPathEntries,
  useLearningPaths,
  useDiscoverMore,
  useCatalogProgress,
  selectContinueLearning,
  pathCatalogIdentities,
  useMyAssignments,
  BADGES,
  getPathsData,
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
import { getBadgeProgress } from './badge-utils';
import { getMyLearningStyles } from './MyLearningTab.styles';
import { BadgeDetailCard } from './BadgeDetailCard';
import { HeroStats } from './sections/HeroStats';
import { MyCoursesSection } from './sections/MyCoursesSection';
import { PrivatePathsSection } from './sections/PrivatePathsSection';
import { BadgesSection } from './sections/BadgesSection';
import { DiscoverMoreSection } from './sections/DiscoverMoreSection';
import { useCatalogLaunch } from './useCatalogLaunch';
import { ContinueLearningSection } from './sections/ContinueLearningSection';
import { CompletedSection } from './sections/CompletedSection';

interface MyLearningTabProps {
  homepage?: boolean;
  /**
   * Called once the guide has been fetched, snippet-expanded, and classified,
   * so the host can choose the display surface (full-screen for reading-only
   * content, sidebar/floating when it drives the Grafana UI) and open the tab
   * without a second fetch.
   */
  onOpenGuide: (launch: PreparedGuideLaunch) => void;
}

export function MyLearningTab({ onOpenGuide, homepage = false }: MyLearningTabProps) {
  const getStyles = useCallback((theme: GrafanaTheme2) => getMyLearningStyles(theme, homepage), [homepage]);
  const styles = useStyles2(getStyles);
  const exploreStyles = useStyles2(getPackageBrowserStyles);
  // Guards against a second launch while the first is still fetching/classifying.
  const launchInFlightRef = useRef(false);
  // Drives the pending affordance on the launching card while the ref above
  // stays the correctness guard. Shared by course cards and Discover More.
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

  const { assignmentByTargetId, onlinePaths, getPathGuides } = useMyAssignments({
    paths,
    getPathProgress,
    getPathGuides: getLocalPathGuides,
    completedGuides: progress.completedGuides,
    resolveNavLinks: resolvePackageNavLinks,
  });

  // An unsatisfied assignment keeps a path in My Courses even at 100% local
  // progress; online-catalogue paths exist only because they're assigned, so
  // their wire `satisfied`/`progress` decide the section.
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
  // An assigned private path also surfaces here, same as an online-catalogue
  // one — alongside Private Paths, not instead of it; duplication is fine.
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
  const homeContinuePaths = homePathEntries.filter((entry) => entry.percent > 0 && entry.percent < 100);
  const homeContinueGuides = catalog.items.filter((item) => {
    const percent = catalogProgress.get(item.key)?.percent ?? 0;
    return item.format === 'guide' && Number.isFinite(percent) && percent > 0 && percent < 100;
  });
  const homeAvailablePaths = homePathEntries.filter((entry) => !(entry.percent > 0 && entry.percent < 100));
  const catalogLaunch = useCatalogLaunch(catalog.items, catalog.scope, catalogProgress, { loadInSidebar: homepage });
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
        getAppEvents().publish({
          type: 'alert-error',
          payload: [
            t('myLearning.launchErrorTitle', 'Could not open the guide'),
            t('myLearning.launchErrorMessage', 'Something went wrong while loading the guide. Please try again.'),
          ],
        });
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

  // Manifest-backed (package) paths — App Platform or online packages alike —
  // have no cover `url` the way URL-based cloud paths do, so a fresh launch
  // has to resolve the path's own cover contentUrl before opening it. Mirrors
  // the URL-based branch in handleOpenGuide below, which already has one.
  //
  // The lock is acquired here, before resolvePackageNavLinks, rather than
  // inside `launch` — Continue/Start buttons disable purely on `launchingId`,
  // so a lock acquired only inside `launch` would leave that whole resolve
  // window unguarded, letting a second click start another resolve (and
  // potentially open a different path) before the first one ever reaches
  // `launch`'s own lock.
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
        // A resolver miss shouldn't fail the whole launch: fall back to the
        // first member guide, same as a manifest-backed path used to do via
        // getGuideUrlForPath before the cover page had its own contentUrl.
        const coverUrl = navLink?.contentUrl || getGuideUrlForPath(path.guides[0] ?? '', path.id) || '';

        reportAppInteraction(UserInteraction.OpenResourceClick, {
          content_title: path.title,
          content_url: coverUrl || `package:${path.id}`,
          content_type: AnalyticsContentType.LearningJourney,
          interaction_location: 'my_learning_tab',
          // The fallback opens the first member guide, not the cover — the
          // discriminator must reflect what actually opened, not what was intended.
          launch_target: navLink?.contentUrl ? 'cover_page' : 'first_guide_fallback',
        });

        if (!coverUrl) {
          logger.error('[MyLearning] Could not resolve a cover or fallback URL for path', { path_id: path.id });
          getAppEvents().publish({
            type: 'alert-error',
            payload: [
              t('myLearning.launchErrorTitle', 'Could not open the guide'),
              t('myLearning.launchErrorMessage', 'Something went wrong while loading the guide. Please try again.'),
            ],
          });
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
    (guideId: string, pathId: string) => {
      const parentPath = allPaths.find((p) => p.id === pathId);

      // Manifest-backed (package) paths — App Platform and public/CDN course
      // packages alike — always land on their own cover page from My Learning,
      // fresh or resumed, same as URL-based cloud paths below. The rendering
      // pipeline is identical for every repository
      // (docs/design/package/learning-journeys.md), so there's no reason to
      // special-case one source over another here. Whether the cover itself
      // is interactive is decided by prepareGuideLaunch's own content-based
      // classification, independent of progress — resuming a course whose
      // cover happens to be interactive still ends up in the sidebar, exactly
      // like a fresh launch would.
      if (parentPath?.manifest && !parentPath.url) {
        void openPathCover(parentPath);
        return;
      }

      if (parentPath?.url) {
        // The path's own url is its cover page; the cover's own CTA
        // ("Get started" / "Resume") is what resolves the current milestone,
        // using real completion data — see LearningPathTableOfContents.
        reportAppInteraction(UserInteraction.OpenResourceClick, {
          content_title: parentPath.title,
          content_url: parentPath.url,
          content_type: AnalyticsContentType.LearningJourney,
          interaction_location: 'my_learning_tab',
          launch_target: 'cover_page',
        });

        void launch(parentPath.url, parentPath.title, parentPath.id);
        return;
      }

      // Static or App Platform guide — resolve via the path-scoped metadata
      // hook exposes (covers App Platform member guides too, RFC §6.11),
      // falling back to the static bundled catalogue as before.
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

      // Track learning path progress when user opens a guide from a path
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

      // App Platform paths carry a manifest but no cover `url`, so the member
      // launches as `backend-guide:<id>`. Thread the PATH manifest through as
      // packageInfo (mirroring CustomGuidesSection) — without it the loader
      // falls through to plain fetchContent and the member renders as a
      // standalone guide with no milestone toolbar, next/prev, or cover.
      const packageInfo: PackageOpenInfo | undefined = parentPath?.manifest
        ? { packageId: parentPath.id, packageManifest: { ...parentPath.manifest, id: parentPath.id } }
        : undefined;

      void launch(guideUrl, title, pathId, packageInfo);
    },
    [launch, allPaths, getPathProgress, getPathGuides, getGuideUrlForPath, openPathCover]
  );

  const handleViewPath = (path: LearningPath) => {
    if (path.manifest && !path.url) {
      void openPathCover(path, true);
    } else if (path.url) {
      void launch(path.url, path.title, path.id, undefined, true);
    } else {
      handleOpenGuide(path.guides[0] ?? '', path.id);
    }
  };

  const handleHomePathView = (entry: HomePathEntry) => {
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
      handleViewPath(entry.path);
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

  const selectedBadgeProgress = useMemo(() => {
    if (!selectedBadge) {
      return null;
    }
    const baseBadge = BADGES.find((b) => b.id === selectedBadge.id);
    if (!baseBadge) {
      return null;
    }
    return getBadgeProgress(baseBadge, progress.completedGuides, progress.streakDays, pathsForProgress);
  }, [selectedBadge, progress.completedGuides, progress.streakDays, pathsForProgress]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <SkeletonLoader type="recommendations" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <HeroStats
        narrative={homepage}
        guidesCompleted={totalGuidesCompleted}
        pathsCompleted={totalPathsCompleted}
        badgesEarned={totalBadgesEarned}
        streakDays={streakInfo.days}
        styles={styles}
      />

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
          title="Continue learning"
          description="Pick up guides and paths you have started."
          icon="play"
          entries={homeContinuePaths}
          onView={handleHomePathView}
          styles={styles}
        >
          {homeContinueGuides.map((item) => (
            <LearningContentCard
              key={item.key}
              tile
              title={item.title}
              description={item.description}
              kind="guide"
              topic={catalogTopic(item)}
              organization={item.source === 'organization'}
              progress={catalogProgress.get(item.key)?.percent}
              effort={item.activityCount !== undefined ? `${item.activityCount} activities` : undefined}
              onViewPath={() => {
                void catalogLaunch.launch(item);
              }}
              onLaunch={() => catalogLaunch.launch(item)}
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
          onViewPath={handleViewPath}
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
              onViewPath={handleViewPath}
              onReset={resetPath}
              onResetGuides={resetPathGuides}
              launchingPathId={launchingId}
              launchDisabled={launchingId !== null || catalogLaunch.launchingKey !== null}
              styles={styles}
            />
          )}
          {homepage && (
            <HomeLearningPathsSection
              title="Your learning paths"
              description="Learning paths available to you, including assignments."
              icon="book-open"
              entries={homeAvailablePaths}
              onView={handleHomePathView}
              styles={styles}
            />
          )}

          {homepage && (
            <section className={styles.openSection}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIcon}>
                  <Icon name="compass" size="lg" />
                </span>
                <div className={styles.sectionHeadingText}>
                  <h2 className={styles.sectionTitle}>Explore learning</h2>
                  <p className={styles.sectionDescription}>Find your next guide or learning path by topic.</p>
                </div>
                <LinkButton href={`${prefixRoute(ROUTES.Browse)}?view=all`} variant="primary" size="md">
                  Explore all <Icon name="arrow-right" />
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
                      <small>{topic.count} guides and paths</small>
                    </span>
                  </a>
                ))}
              </div>
              {catalog.loading && homeTopics.length === 0 && <SkeletonLoader type="recommendations" />}
            </section>
          )}

          <BadgesSection
            badges={sortedBadges}
            completedGuides={progress.completedGuides}
            streakDays={progress.streakDays}
            paths={pathsForProgress}
            onSelect={setSelectedBadge}
            styles={styles}
          />
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

      {/* Badge Detail Card Overlay */}
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
