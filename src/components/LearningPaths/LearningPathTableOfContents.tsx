import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useStyles2, Icon, TabsBar, Tab } from '@grafana/ui';
import { t } from '@grafana/i18n';

import type { CoverPageTrack, Milestone } from '../../types/content.types';
import type { PathGuide } from '../../types/learning-paths.types';
import { FOUNDATIONS_TRACK_ID } from '../../types/package.types';
import { journeyMilestonePercentages, percentagesToProgress } from '../../docs-retrieval';
import { getGuideProgressRevision, subscribeGuideProgressRevision } from '../../global-state/progress-events';
import { testIds } from '../../constants/testIds';
import { getBadgeForPath } from '../../learning-paths';
import { GuideList } from './GuideList';
import { ProgressRing } from './ProgressRing';
import { BadgeIcon } from './BadgeIcon';
import { getTableOfContentsStyles } from './learning-paths.styles';

/**
 * Tab id for the always-present default sequence — never a real trackId.
 * Enforced in `getManifestTracks` (package.types.ts), the one place every
 * tracks consumer reads through, so this holds for every manifest this
 * component ever receives `tracks` from — not only ones that passed through
 * the CLI's `validate` command.
 */
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
  /**
   * Notified whenever the selected track tab changes, including once on
   * mount — `null`/`null` for the default Foundations sequence, a track's
   * own `trackId` plus its resolved guides otherwise. Lets Next/Previous
   * resolve within the selected track past the cover page too (see
   * `LearningJourneyTab.activeTrackMilestones`).
   */
  onActiveTrackChange?: (trackId: string | null, milestones: Milestone[] | null) => void;
  /**
   * The track selected the last time this path's cover page was shown, if
   * any — restores the tab selection on mount instead of defaulting to
   * Foundations. Every navigation remounts this component (ContentRenderer
   * keys on the loaded URL), so without this a reader who picks a track and
   * later hits Previous back to the cover loses that selection: the fresh
   * mount's own mount-time `onActiveTrackChange` call would overwrite the
   * caller's record with Foundations. Ignored when it doesn't name a real
   * track in `tracks` (a different path's leftover selection).
   */
  initialActiveTrackId?: string | null;
}

export function LearningPathTableOfContents({
  milestones,
  baseUrl,
  pathId,
  title,
  description,
  tracks,
  onActiveTrackChange,
  initialActiveTrackId,
}: LearningPathTableOfContentsProps) {
  const styles = useStyles2(getTableOfContentsStyles);
  const badge = pathId ? getBadgeForPath(pathId) : undefined;

  const hasTracks = tracks !== undefined && tracks.length > 0;
  const [activeTabId, setActiveTabId] = useState<string>(() =>
    initialActiveTrackId != null && tracks?.some((track) => track.trackId === initialActiveTrackId)
      ? initialActiveTrackId
      : FOUNDATIONS_TAB_ID
  );
  // Adjusting state during render (same React-endorsed reset pattern as the
  // percentages/progress below): baseUrl is this path's own identity, so
  // navigating to a DIFFERENT path resets the tab selection back to
  // Foundations. Without this, activeTabId survives across paths — there is
  // no remount key between them, content-renderer.tsx reuses this component
  // instance — and a track selected on one path either shows no tab as
  // active on the next (its trackId doesn't exist there) or, worse, silently
  // pre-selects a same-named track on the new path the reader never clicked.
  const [activeTabPathBaseUrl, setActiveTabPathBaseUrl] = useState(baseUrl);
  if (activeTabPathBaseUrl !== baseUrl) {
    setActiveTabPathBaseUrl(baseUrl);
    setActiveTabId(FOUNDATIONS_TAB_ID);
  }
  const activeTrack =
    hasTracks && activeTabId !== FOUNDATIONS_TAB_ID
      ? tracks!.find((track) => track.trackId === activeTabId)
      : undefined;
  const activeMilestones = activeTrack?.milestones ?? milestones;

  // Fires on mount too, so the panel model's active-track record never starts stale.
  useEffect(() => {
    onActiveTrackChange?.(activeTrack?.trackId ?? null, activeTrack?.milestones ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the selection itself and its owning path should re-fire this, not a fresh onActiveTrackChange identity every render
  }, [activeTrack?.trackId, baseUrl]);
  // The active sequence's own name, not the path's — reused below to scope
  // the progress ring's accessible label. A track is a presentation
  // ordering only (COMPLETION-MODEL.md), so its ring must read as "progress
  // through this track," never as path-wide completion.
  const activeSequenceLabel = activeTrack?.label ?? t('coverPage.foundationsTab', 'Foundations');

  // The segments below read each milestone's percentage out of storage, so the
  // store's announcement is what keeps them from painting a stale fill —
  // mirrors the in-guide milestone toolbar's own subscription for the same reason.
  useSyncExternalStore(subscribeGuideProgressRevision, getGuideProgressRevision, getGuideProgressRevision);

  // The shared per-milestone calculation (docs/design/COMPLETION-MODEL.md,
  // decision 4/9): the same numbers `progress` below is the mean of, so the
  // checkmarks here and the sidebar milestone bar never disagree about which
  // milestones are done. Synchronous, so there is no "progress not loaded
  // yet" window the CTA/click target could race. Computed once and reused
  // for `progress` below rather than calling it a second time.
  //
  // Scoped to whichever sequence is active, not to the path as a whole: a
  // track is a presentation ordering over a subset/superset of guides, never
  // a second completion authority (COMPLETION-MODEL.md's decision on this).
  // The durable, path-wide percentage shown elsewhere (My Learning) stays
  // keyed to Foundations `milestones` membership alone and can legitimately
  // read lower than this ring on a track tab — same underlying guides,
  // different denominators. The ring's aria-label below names the active
  // sequence so this reads as "progress through Foundations/this track,"
  // never as path completion.
  const milestonePercentages = journeyMilestonePercentages(baseUrl, activeMilestones);
  const completedUrls = new Set(
    milestonePercentages.filter(({ percent }) => percent === 100).map(({ milestone }) => milestone.url)
  );

  // "Get started" targets the first unlocked milestone at 0% progress; once
  // underway, "Resume" targets the actual next incomplete one so returning to
  // the cover mid-path (e.g. via Previous) doesn't restart it from module 1.
  // Every later milestone is sequentially locked — it isn't reachable yet
  // regardless of its own publish-lock state, which stays authoritative for
  // "unpublished" (locked even once its turn comes).
  const cursor = activeMilestones.findIndex((m) => !m.isLocked && !completedUrls.has(m.url));

  const guides: PathGuide[] = activeMilestones.map((milestone, index) => {
    const completed = completedUrls.has(milestone.url);
    return {
      // React-key-only — falls back to the ordinal for a fixture/edge case
      // that never set Milestone.id. Never sent as a click-target id (see
      // guideId below): an ordinal like "3" would never match a real
      // manifest id and would misclassify the next load as the cover page.
      id: milestone.id ?? String(milestone.number),
      // The real manifest guide id, only when resolveGuideIdsToMilestones set
      // one (every real usage) — undefined otherwise, never the ordinal
      // fallback above. GuideList threads this through data-milestone-id so
      // fetchPackageContent can classify the next load by direct lookup
      // instead of a resolved-URL comparison.
      guideId: milestone.id,
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
  const progress = percentagesToProgress(milestonePercentages);

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
        <TabsBar className={styles.tracksTabs} data-testid={testIds.learningPaths.tracksTabs}>
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
        // Unconditional — progress is synchronous (see the comment above), so
        // there is no "not loaded yet" window to gate on. See
        // E2E_TESTING_CONTRACT.md.
        data-test-path-percent={progress}
      >
        <div className={styles.header}>
          <h2 className={styles.heading}>
            <Icon name="list-ul" size="md" className={styles.headingIcon} />
            {t('coverPage.tableOfContents', 'In this path')}
          </h2>
          <div className={styles.headerActions}>
            {progress > 0 && (
              <ProgressRing
                progress={progress}
                size={40}
                strokeWidth={3}
                isCompleted={progress >= 100}
                ariaLabel={t('coverPage.progressAriaLabel', '{{percent}}% through {{sequence}}', {
                  percent: Math.round(progress),
                  sequence: activeSequenceLabel,
                })}
              />
            )}
            {ctaTarget && (
              <button
                type="button"
                className={styles.ctaButton}
                data-journey-start="true"
                data-milestone-url={ctaTarget.url}
                {...(ctaTarget.id != null && { 'data-milestone-id': ctaTarget.id })}
                data-interaction-location={progress === 0 ? 'get_started_cta' : 'resume_cta'}
                data-testid={testIds.learningPaths.tableOfContentsCta}
              >
                <Icon name="play" size="sm" />
                {ctaLabel}
              </button>
            )}
          </div>
        </div>
        <GuideList guides={guides} enableCurrentRowLink />
      </div>
    </>
  );
}
