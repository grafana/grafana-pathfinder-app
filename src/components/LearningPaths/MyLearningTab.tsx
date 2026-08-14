/**
 * My Learning Tab Component
 *
 * A dedicated gamified tab for courses, badges, and progress tracking.
 * Composes the hero, My Courses / Badges columns, Discover More, and
 * Completed sections into a single learning surface.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import { t } from '@grafana/i18n';

import { prepareGuideLaunch, type PreparedGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { resolvePackageNavLinks } from '../../docs-retrieval';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import type { LearningPath } from '../../types/learning-paths.types';
import { useLearningPaths, useDiscoverMore, BADGES, getPathsData, type DiscoverMoreItem } from '../../learning-paths';
import { testIds } from '../../constants/testIds';
import { SkeletonLoader } from '../SkeletonLoader';
import { FeedbackButton } from '../FeedbackButton/FeedbackButton';
import { reportAppInteraction, UserInteraction, AnalyticsContentType } from '../../lib/analytics';
import { logger } from '../../lib/logging';
import { normalizeTelemetryUrl } from '../../lib/telemetry';
import { StorageEvents } from '../../lib/event-names';
import {
  learningProgressStorage,
  journeyCompletionStorage,
  interactiveStepStorage,
  interactiveCompletionStorage,
  milestoneCompletionStorage,
} from '../../lib/user-storage';
import { evictAllContentCaches } from '../../global-state/completion-store';
import { discardQueuedCompletionWrites } from '../../completion-records';
import type { EarnedBadge } from '../../types';

import { getBadgeProgress } from './badge-utils';
import { getMyLearningStyles } from './MyLearningTab.styles';
import { BadgeDetailCard } from './BadgeDetailCard';
import { HeroStats } from './sections/HeroStats';
import { MyCoursesSection } from './sections/MyCoursesSection';
import { PrivatePathsSection } from './sections/PrivatePathsSection';
import { BadgesSection } from './sections/BadgesSection';
import { DiscoverMoreSection } from './sections/DiscoverMoreSection';
import { CompletedSection } from './sections/CompletedSection';

interface MyLearningTabProps {
  /**
   * Called once the guide has been fetched, snippet-expanded, and classified,
   * so the host can choose the display surface (full-screen for reading-only
   * content, sidebar/floating when it drives the Grafana UI) and open the tab
   * without a second fetch.
   */
  onOpenGuide: (launch: PreparedGuideLaunch) => void;
}

export function MyLearningTab({ onOpenGuide }: MyLearningTabProps) {
  const styles = useStyles2(getMyLearningStyles);
  // Guards against a second launch while the first is still fetching/classifying.
  const launchInFlightRef = useRef(false);
  // Drives the pending affordance on the launching card while the ref above
  // stays the correctness guard. Shared by course cards and Discover More.
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [selectedBadge, setSelectedBadge] = useState<EarnedBadge | null>(null);

  const {
    paths,
    badgesWithStatus,
    progress,
    getPathGuides,
    getPathProgress,
    isPathCompleted,
    getGuideUrlForPath,
    resetPath,
    streakInfo,
    isLoading,
  } = useLearningPaths();

  const inProgress = useMemo(() => {
    return paths
      .filter((path) => getPathProgress(path.id) < 100)
      .sort((a, b) => getPathProgress(b.id) - getPathProgress(a.id));
  }, [paths, getPathProgress]);

  const privatePaths = useMemo(() => inProgress.filter((path) => path.isPrivate), [inProgress]);
  const courses = useMemo(() => inProgress.filter((path) => !path.isPrivate), [inProgress]);

  const completedPaths = useMemo(() => paths.filter((path) => isPathCompleted(path.id)), [paths, isPathCompleted]);

  const excludeTitles = useMemo(
    () => new Set([...inProgress, ...completedPaths].map((path) => path.title)),
    [inProgress, completedPaths]
  );
  const { items: discoverItems, isLoading: discoverLoading } = useDiscoverMore({ excludeTitles });

  // Fetch + snippet-expand + classify the target, then hand the prepared
  // launch to the host so it can pick the surface without re-fetching. The
  // fetch happens while My Learning stays mounted; on failure My Learning stays
  // visible and the error is surfaced rather than committing a surface.
  const launch = useCallback(
    async (url: string, title: string, launchId: string, packageInfo?: PackageOpenInfo) => {
      if (launchInFlightRef.current) {
        return;
      }
      launchInFlightRef.current = true;
      setLaunchingId(launchId);
      try {
        const result = await prepareGuideLaunch(url, { title, source: 'home_page', packageInfo });
        // The prepare step can outlive this page (the fetches are bounded but
        // slow-CDN cases run tens of seconds). If the user navigated away,
        // drop the result — launching now would yank them to /fullscreen from
        // wherever they landed.
        if (!mountedRef.current) {
          return;
        }
        if (result.ok) {
          onOpenGuide(result.launch);
        } else {
          // Log context reaches Faro attributes verbatim, so only stable,
          // low-cardinality values go in: the URL loses its query and fragment,
          // and the classification code stands in for `result.error`, whose free
          // text can echo fetched-guide values. The user sees a translated
          // generic message either way.
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
      } finally {
        launchInFlightRef.current = false;
        if (mountedRef.current) {
          setLaunchingId(null);
        }
      }
    },
    [onOpenGuide]
  );

  // Manifest-backed (package) paths — App Platform or online packages alike —
  // have no cover `url` the way URL-based cloud paths do, so a fresh launch
  // has to resolve the path's own cover contentUrl before opening it. Mirrors
  // the URL-based branch in handleOpenGuide below, which already has one.
  const openPathCover = useCallback(
    async (path: LearningPath) => {
      const packageInfo: PackageOpenInfo = {
        packageId: path.id,
        packageManifest: { ...path.manifest, id: path.id },
      };
      const [navLink] = await resolvePackageNavLinks([path.id]);
      const coverUrl = navLink?.contentUrl ?? '';

      reportAppInteraction(UserInteraction.OpenResourceClick, {
        content_title: path.title,
        content_url: coverUrl || `package:${path.id}`,
        content_type: AnalyticsContentType.LearningJourney,
        interaction_location: 'my_learning_tab',
        launch_target: 'cover_page',
      });

      void launch(coverUrl, path.title, path.id, packageInfo);
    },
    [launch]
  );

  const handleOpenGuide = useCallback(
    (guideId: string, pathId: string) => {
      const parentPath = paths.find((p) => p.id === pathId);

      // Manifest-backed (package) paths — App Platform and public/CDN course
      // packages alike — land on their own cover page on a fresh launch, same
      // as URL-based cloud paths below. The rendering pipeline is identical
      // for every repository (docs/design/package/learning-journeys.md), so
      // there's no reason to special-case one source over another here.
      if (parentPath?.manifest && !parentPath.url && getPathProgress(parentPath.id) === 0) {
        void openPathCover(parentPath);
        return;
      }

      if (parentPath?.url) {
        const isFreshLaunch = getPathProgress(parentPath.id) === 0;
        const launchTarget = isFreshLaunch ? 'cover_page' : 'milestone';
        // The path base URL is its cover page; continuing still resolves the current milestone.
        const resolvedGuideUrl = isFreshLaunch
          ? parentPath.url
          : (getGuideUrlForPath(guideId, parentPath.id) ?? parentPath.url);
        const guideTitle = isFreshLaunch
          ? parentPath.title
          : getPathGuides(parentPath.id).find((g) => g.id === guideId)?.title;
        const title = guideTitle || parentPath.title;

        reportAppInteraction(UserInteraction.OpenResourceClick, {
          content_title: title,
          content_url: resolvedGuideUrl,
          content_type: AnalyticsContentType.LearningJourney,
          interaction_location: 'my_learning_tab',
          launch_target: launchTarget,
        });

        void launch(resolvedGuideUrl, title, parentPath.id);
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
    [launch, paths, getPathProgress, getPathGuides, getGuideUrlForPath, openPathCover]
  );

  const handleDiscoverStart = useCallback(
    (item: DiscoverMoreItem) => {
      reportAppInteraction(UserInteraction.OpenResourceClick, {
        content_title: item.title,
        content_url: item.contentUrl,
        content_type: AnalyticsContentType.LearningJourney,
        interaction_location: 'my_learning_discover_more',
      });

      // prepareGuideLaunch backfills packageInfo from the URL when absent, but
      // the manifest is already inlined here — passing it saves that re-fetch.
      const packageInfo: PackageOpenInfo | undefined = item.manifest
        ? { packageId: item.id, packageManifest: { ...item.manifest, id: item.id } }
        : undefined;

      void launch(item.contentUrl, item.title, item.id, packageInfo);
    },
    [launch]
  );

  const handleResetProgress = useCallback(async () => {
    if (window.confirm('Reset all learning progress? This will clear completed guides, badges, and streaks.')) {
      // Durable completion writes that are queued but not yet sent are dropped
      // first, before any await below yields: a drain scheduled before the reset
      // would otherwise fire inside that window and mint records for exactly the
      // guides the user just asked us to forget — and the dialog gives them no
      // second lever to stop it.
      discardQueuedCompletionWrites();

      await learningProgressStorage.clear();

      // Clear journey completion percentages
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

  const totalGuidesCompleted = progress.completedGuides.length;
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
        guidesCompleted={totalGuidesCompleted}
        badgesEarned={totalBadgesEarned}
        streakDays={streakInfo.days}
        styles={styles}
      />

      <PrivatePathsSection
        paths={privatePaths}
        getPathGuides={getPathGuides}
        getPathProgress={getPathProgress}
        onContinue={handleOpenGuide}
        onReset={resetPath}
        launchingPathId={launchingId}
        launchDisabled={launchingId !== null}
        styles={styles}
      />

      {/* My Courses ∥ Badges — collapses to stacked on narrow panels */}
      <div className={styles.columnsContainer}>
        <div className={styles.columnsRow}>
          <MyCoursesSection
            courses={courses}
            getPathGuides={getPathGuides}
            getPathProgress={getPathProgress}
            onContinue={handleOpenGuide}
            onReset={resetPath}
            launchingPathId={launchingId}
            launchDisabled={launchingId !== null}
            styles={styles}
          />

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

      <DiscoverMoreSection
        items={discoverItems}
        isLoading={discoverLoading}
        onStart={handleDiscoverStart}
        startingId={launchingId}
        startDisabled={launchingId !== null}
        styles={styles}
      />

      <CompletedSection completed={completedPaths} styles={styles} />

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
