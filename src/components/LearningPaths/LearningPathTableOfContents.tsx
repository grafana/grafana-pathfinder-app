import React, { useEffect, useState } from 'react';
import { useStyles2, Icon, TabsBar, Tab } from '@grafana/ui';
import { t } from '@grafana/i18n';

import type { CoverPageTrack, Milestone } from '../../types/content.types';
import type { PathGuide } from '../../types/learning-paths.types';
import { FOUNDATIONS_TRACK_ID } from '../../types/package.types';
import { milestoneCompletionStorage } from '../../lib/user-storage';
import { getMilestoneSlug } from '../../lib/learning-journey-url';
import { journeyProgressFromMilestones } from '../../docs-retrieval';
import { testIds } from '../../constants/testIds';
import { getBadgeForPath } from '../../learning-paths';
import { GuideList } from './GuideList';
import { ProgressRing } from './ProgressRing';
import { BadgeIcon } from './BadgeIcon';
import { getTableOfContentsStyles } from './learning-paths.styles';

/** Tab id for the always-present default sequence — never a real trackId (schema-enforced). */
const FOUNDATIONS_TAB_ID = FOUNDATIONS_TRACK_ID;

export interface LearningPathTableOfContentsProps {
  milestones: Milestone[];
  baseUrl: string;
  /** Package manifest ID, when known — used to look up a completion badge to preview. */
  pathId?: string;
  /** The path's own title, when known — shown as the hero heading above the description. */
  title?: string;
  /** Package manifest description, when known — shown as the hero summary above the module list. */
  description?: string;
  /**
   * Named, independently-ordered guide sequences from the manifest's `tracks`
   * field (Path Tracks RFC), each already resolved to Milestone rows the same
   * way `milestones` is. When present and non-empty, each track gets its own
   * tab alongside the default Foundations sequence (`milestones`); when
   * absent or empty, rendering is unchanged from before tracks existed —
   * a single flat list, no tabs.
   */
  tracks?: CoverPageTrack[];
}

export function LearningPathTableOfContents({
  milestones,
  baseUrl,
  pathId,
  title,
  description,
  tracks,
}: LearningPathTableOfContentsProps) {
  const styles = useStyles2(getTableOfContentsStyles);
  const [completedSlugs, setCompletedSlugs] = useState<Set<string>>(new Set());
  // Guards the CTA and the current-row click target, both derived from
  // completedSlugs: before this resolves, an empty set reads as "0% done,
  // start at module 1" regardless of real progress, and a click during that
  // window would land on the wrong milestone.
  const [progressLoaded, setProgressLoaded] = useState(false);
  const badge = pathId ? getBadgeForPath(pathId) : undefined;

  const hasTracks = tracks !== undefined && tracks.length > 0;
  const [activeTabId, setActiveTabId] = useState<string>(FOUNDATIONS_TAB_ID);
  // Every sequential lock/unlock, progress, and time-estimate calculation
  // below reuses the exact Foundations mechanism (milestoneCompletionStorage
  // + journeyProgressFromMilestones) against whichever sequence is active —
  // there is no track-specific completion model yet. When the progress
  // mechanisms this app carries today (records/milestones/interactive) are
  // consolidated into one, revisit whether a track needs its own.
  const activeMilestones =
    hasTracks && activeTabId !== FOUNDATIONS_TAB_ID
      ? (tracks!.find((track) => track.trackId === activeTabId)?.milestones ?? milestones)
      : milestones;

  useEffect(() => {
    let cancelled = false;
    void milestoneCompletionStorage
      .getCompleted(
        baseUrl,
        activeMilestones.map((milestone) => milestone.url)
      )
      .then((slugs) => {
        if (!cancelled) {
          setCompletedSlugs(slugs);
          setProgressLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, activeMilestones]);

  // "Get started" targets the first unlocked milestone at 0% progress; once
  // underway, "Resume" targets the actual next incomplete one so returning to
  // the cover mid-path (e.g. via Previous) doesn't restart it from module 1.
  // Every later milestone is sequentially locked — it isn't reachable yet
  // regardless of its own publish-lock state, which stays authoritative for
  // "unpublished" (locked even once its turn comes).
  const cursor = activeMilestones.findIndex((m) => !m.isLocked && !completedSlugs.has(getMilestoneSlug(m.url)));

  const guides: PathGuide[] = activeMilestones.map((milestone, index) => {
    const completed = completedSlugs.has(getMilestoneSlug(milestone.url));
    return {
      id: String(milestone.number),
      title: milestone.title,
      description: milestone.description,
      estimatedMinutes: milestone.estimatedMinutes,
      completed,
      isCurrent: cursor >= 0 && index === cursor,
      locked: milestone.isLocked || (!completed && cursor >= 0 && index > cursor),
      url: milestone.url,
    };
  });

  // The shared calculation (docs/design/COMPLETION-MODEL.md, decision 4): the
  // mean of unlocked milestones' own percentages, not a completed-count
  // fraction — so this and the sidebar milestone bar never show two
  // different numbers for the same journey. A reader who only navigated
  // without completing anything sees this at 0%, honestly, even after
  // visiting every milestone.
  const progress = journeyProgressFromMilestones(baseUrl, activeMilestones);

  const ctaTarget = cursor >= 0 ? activeMilestones[cursor] : undefined;
  const ctaLabel = progress === 0 ? t('coverPage.getStarted', 'Get started') : t('coverPage.resume', 'Resume');

  // Sum of authored per-milestone estimates — only when every milestone has
  // one, matching estimatedMinutes' own "never a guessed default" contract.
  // A partial sum across e.g. 3 of 10 authored milestones would understate
  // the real total rather than approximate it.
  const totalEstimatedMinutes =
    activeMilestones.length > 0 && activeMilestones.every((m) => typeof m.estimatedMinutes === 'number')
      ? activeMilestones.reduce((sum, m) => sum + m.estimatedMinutes!, 0)
      : undefined;

  return (
    <>
      {(title || description || badge) && (
        <div className={styles.hero} data-testid={testIds.learningPaths.coverHero}>
          {title && <h1 className={styles.heroTitle}>{title}</h1>}
          {description && <p className={styles.heroDescription}>{description}</p>}
          <div className={styles.heroMeta}>
            <span className={styles.heroMetaItem}>
              <Icon name="list-ul" size="sm" />
              {t('coverPage.moduleCount', '{{count}} modules', { count: activeMilestones.length })}
            </span>
            {totalEstimatedMinutes != null && (
              <span className={styles.heroMetaItem}>
                <Icon name="clock-nine" size="sm" />
                {totalEstimatedMinutes < 60
                  ? t('coverPage.totalMinutes', '{{count}} min', { count: totalEstimatedMinutes })
                  : t('coverPage.totalHours', '~{{count}} hr', { count: Math.round(totalEstimatedMinutes / 60) })}
              </span>
            )}
            {badge && (
              <span className={styles.heroMetaItem}>
                <BadgeIcon emoji={badge.emoji} icon={badge.icon} size="sm" />
                {t('coverPage.earnsBadge', 'Earns {{badge}} badge', { badge: badge.title })}
              </span>
            )}
          </div>
        </div>
      )}
      {hasTracks && (
        <TabsBar data-testid={testIds.learningPaths.tracksTabs}>
          <Tab
            label={t('coverPage.foundationsTab', 'Foundations')}
            active={activeTabId === FOUNDATIONS_TAB_ID}
            onChangeTab={() => setActiveTabId(FOUNDATIONS_TAB_ID)}
            data-testid={testIds.learningPaths.tracksTab(FOUNDATIONS_TAB_ID)}
          />
          {tracks!.map((track) => (
            <Tab
              key={track.trackId}
              label={track.label}
              active={activeTabId === track.trackId}
              onChangeTab={() => setActiveTabId(track.trackId)}
              data-testid={testIds.learningPaths.tracksTab(track.trackId)}
            />
          ))}
        </TabsBar>
      )}
      <div
        className={styles.container}
        data-testid={testIds.learningPaths.tableOfContents}
        // Testing contract: readable at 0%, where the ring below is hidden.
        // Gated on progressLoaded to keep a reader off the first frame — see
        // E2E_TESTING_CONTRACT.md, which owns why this gate is sufficient
        // rather than necessary.
        data-test-path-percent={progressLoaded ? progress : undefined}
      >
        <div className={styles.header}>
          <h2 className={styles.heading}>
            <Icon name="list-ul" size="md" className={styles.headingIcon} />
            {t('coverPage.tableOfContents', 'In this path')}
          </h2>
          <div className={styles.headerActions}>
            {progress > 0 && (
              <ProgressRing progress={progress} size={40} strokeWidth={3} isCompleted={progress >= 100} />
            )}
            {progressLoaded && ctaTarget && (
              <button
                type="button"
                className={styles.ctaButton}
                data-journey-start="true"
                data-milestone-url={ctaTarget.url}
                data-interaction-location={progress === 0 ? 'get_started_cta' : 'resume_cta'}
                data-testid={testIds.learningPaths.tableOfContentsCta}
              >
                <Icon name="play" size="sm" />
                {ctaLabel}
              </button>
            )}
          </div>
        </div>
        <GuideList guides={guides} enableCurrentRowLink={progressLoaded} />
      </div>
    </>
  );
}
