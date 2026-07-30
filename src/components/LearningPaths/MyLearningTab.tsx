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
import { useLearningPaths, useDiscoverMore, BADGES, getPathsData, type DiscoverMoreItem } from '../../learning-paths';
import { testIds } from '../../constants/testIds';
import { SkeletonLoader } from '../SkeletonLoader';
import { FeedbackButton } from '../FeedbackButton/FeedbackButton';
import { reportAppInteraction, UserInteraction, AnalyticsContentType } from '../../lib/analytics';
import { logger } from '../../lib/logging';
import { StorageEvents } from '../../lib/event-names';
import {
  learningProgressStorage,
  journeyCompletionStorage,
  interactiveStepStorage,
  interactiveCompletionStorage,
} from '../../lib/user-storage';
import { evictAllContentCaches } from '../../global-state/completion-store';
import type { EarnedBadge } from '../../types';

import { getBadgeProgress } from './badge-utils';
import { getMyLearningStyles } from './MyLearningTab.styles';
import { BadgeDetailCard } from './BadgeDetailCard';
import { HeroStats } from './sections/HeroStats';
import { MyCoursesSection } from './sections/MyCoursesSection';
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
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [showAllCourses, setShowAllCourses] = useState(false);
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

  const courses = useMemo(() => {
    return paths
      .filter((path) => {
        const pathProgress = getPathProgress(path.id);
        return pathProgress > 0 && pathProgress < 100;
      })
      .sort((a, b) => getPathProgress(b.id) - getPathProgress(a.id));
  }, [paths, getPathProgress]);

  const completedPaths = useMemo(() => paths.filter((path) => isPathCompleted(path.id)), [paths, isPathCompleted]);

  const excludeTitles = useMemo(
    () => new Set([...courses, ...completedPaths].map((path) => path.title)),
    [courses, completedPaths]
  );
  const { items: discoverItems, isLoading: discoverLoading } = useDiscoverMore({ excludeTitles });

  // Fetch + snippet-expand + classify the target, then hand the prepared
  // launch to the host so it can pick the surface without re-fetching. The
  // fetch happens while My Learning stays mounted; on failure My Learning stays
  // visible and the error is surfaced rather than committing a surface.
  const launch = useCallback(
    async (url: string, title: string, launchId: string) => {
      if (launchInFlightRef.current) {
        return;
      }
      launchInFlightRef.current = true;
      setLaunchingId(launchId);
      try {
        const result = await prepareGuideLaunch(url, { title, source: 'home_page' });
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
          // The raw error is internal-shaped — keep it for the logs (Faro
          // bridge makes launch failures countable) and show a translated
          // generic message.
          logger.error('[MyLearning] Guide launch preparation failed', { url, error: result.error });
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

  const handleOpenGuide = useCallback(
    (guideId: string, pathId: string) => {
      // Find the parent path by ID (not by guideId, since multiple paths may share the same guide slugs)
      const parentPath = paths.find((p) => p.id === pathId);

      // URL-based path — open the per-guide URL when known so the user lands
      // on the actual next module instead of the path base / first module
      // (issue #744). When dynamic data has not loaded yet, fall back to the
      // path's base URL.
      if (parentPath?.url) {
        const resolvedGuideUrl = getGuideUrlForPath(guideId, parentPath.id) ?? parentPath.url;
        const guideTitle = getPathGuides(parentPath.id).find((g) => g.id === guideId)?.title;
        const title = guideTitle || parentPath.title;

        reportAppInteraction(UserInteraction.OpenResourceClick, {
          content_title: title,
          content_url: resolvedGuideUrl,
          content_type: AnalyticsContentType.LearningJourney,
          interaction_location: 'my_learning_tab',
        });

        void launch(resolvedGuideUrl, title, parentPath.id);
        return;
      }

      // Static guide — open the individual guide content
      const guideMetadata = getPathsData().guideMetadata[guideId];
      const title = guideMetadata?.title || guideId;
      const guideUrl = guideMetadata?.url ?? `bundled:${guideId}`;

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

      void launch(guideUrl, title, pathId);
    },
    [launch, paths, getPathProgress, getPathGuides, getGuideUrlForPath]
  );

  const handleDiscoverStart = useCallback(
    (item: DiscoverMoreItem) => {
      reportAppInteraction(UserInteraction.OpenResourceClick, {
        content_title: item.title,
        content_url: item.contentUrl,
        content_type: AnalyticsContentType.LearningJourney,
        interaction_location: 'my_learning_discover_more',
      });
      void launch(item.contentUrl, item.title, item.id);
    },
    [launch]
  );

  const handleResetProgress = useCallback(async () => {
    if (window.confirm('Reset all learning progress? This will clear completed guides, badges, and streaks.')) {
      await learningProgressStorage.clear();

      // Clear journey completion percentages
      const completions = await journeyCompletionStorage.getAll();
      for (const url of Object.keys(completions)) {
        await journeyCompletionStorage.clear(url);
      }

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
  const totalBadges = badgesWithStatus.length;

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
        totalBadges={totalBadges}
        streakDays={streakInfo.days}
        styles={styles}
      />

      {/* My Courses ∥ Badges — collapses to stacked on narrow panels */}
      <div className={styles.columnsRow}>
        <MyCoursesSection
          courses={courses}
          showAll={showAllCourses}
          onToggleShowAll={() => setShowAllCourses((v) => !v)}
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
          totalBadges={totalBadges}
          showAll={showAllBadges}
          onToggleShowAll={() => setShowAllBadges((v) => !v)}
          completedGuides={progress.completedGuides}
          streakDays={progress.streakDays}
          paths={pathsForProgress}
          onSelect={setSelectedBadge}
          styles={styles}
        />
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
