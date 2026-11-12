import { milestoneCountText } from '../LearningContentCard/learning-effort';
import { getLearningTopicMetadata } from '../LearningContentCard/learning-topic-visual';
import { catalogTopic } from '../../lib/catalog-discovery';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useStyles2, Icon, TabsBar, Tab, Button, Badge, Link } from '@grafana/ui';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';

import type { CoverPageTrack, Milestone } from '../../types/content.types';
import type { PathGuide, LearningProgress } from '../../types/learning-paths.types';
import { learningProgressStorage } from '../../lib/user-storage';
import { StorageEvents } from '../../lib/event-names';
import { FOUNDATIONS_TRACK_ID } from '../../types/package.types';
import { journeyMilestonePercentages, percentagesToProgress } from '../../docs-retrieval';
import { getGuideProgressRevision, subscribeGuideProgressRevision } from '../../global-state/progress-events';
import { testIds } from '../../constants/testIds';
import { getBadgeForPath, getCourseCompletionBadges } from '../../learning-paths';
import { GuideList } from './GuideList';
import { ProgressRing } from './ProgressRing';
import { BadgeIcon } from './BadgeIcon';
import { BadgeGridItem } from './BadgeGridItem';
import { BadgeDetailCard } from './BadgeDetailCard';
import { getBadgeProgress } from './badge-utils';
import { getMyLearningStyles } from './MyLearningTab.styles';
import { getMilestoneSlug } from '../../lib/learning-journey-url';
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
  fullPage?: boolean;
  category?: string;
  organization?: boolean;
  estimatedMinutes?: number;
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
  fullPage = false,
  category,
  organization = false,
  estimatedMinutes,
  milestones,
  baseUrl,
  pathId,
  title,
  description,
  tracks,
  onActiveTrackChange,
  initialActiveTrackId,
}: LearningPathTableOfContentsProps) {
  const compactStyles = useStyles2(getTableOfContentsStyles);
  const fullPageStyles = useStyles2(getFullPageStyles);
  const badgeStyles = useStyles2(getMyLearningStyles);
  const styles = fullPage ? { ...compactStyles, ...fullPageStyles } : compactStyles;
  const badge = !fullPage && pathId ? getBadgeForPath(pathId) : undefined;
  const courseBadges = fullPage ? getCourseCompletionBadges({ pathId, baseUrl, organization }) : [];
  const hasCourseBadges = courseBadges.length > 0;
  const [learningProgress, setLearningProgress] = useState<LearningProgress | null>(null);
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);
  const earnedBadges = learningProgress?.earnedBadges ?? [];
  const badgePaths = courseBadges.flatMap((courseBadge) =>
    courseBadge.trigger.type === 'path-completed'
      ? [
          {
            id: courseBadge.trigger.pathId,
            guides: milestones.map((milestone) => milestone.id ?? getMilestoneSlug(milestone.url)),
          },
        ]
      : []
  );
  const selectedBadge = courseBadges.find((courseBadge) => courseBadge.id === selectedBadgeId);
  const selectedBadgeWithStatus = selectedBadge
    ? { ...selectedBadge, earnedAt: earnedBadges.find((earned) => earned.id === selectedBadge.id)?.earnedAt }
    : null;
  const selectedBadgeProgress = selectedBadge
    ? getBadgeProgress(
        selectedBadge,
        learningProgress?.completedGuides ?? [],
        learningProgress?.streakDays ?? 0,
        badgePaths
      )
    : null;
  useEffect(() => {
    if (!hasCourseBadges) {
      return;
    }
    let mounted = true;
    let revision = 0;
    const loadEarnedBadges = async () => {
      const currentRevision = ++revision;
      const progress = await learningProgressStorage.get();
      if (mounted && currentRevision === revision) {
        setLearningProgress(progress ?? null);
      }
    };
    const handleProgressUpdate = () => void loadEarnedBadges();
    window.addEventListener(StorageEvents.LearningProgressUpdated, handleProgressUpdate);
    void loadEarnedBadges();
    return () => {
      mounted = false;
      window.removeEventListener(StorageEvents.LearningProgressUpdated, handleProgressUpdate);
    };
  }, [hasCourseBadges]);
  const topicId = catalogTopic({ id: pathId ?? '', title: title ?? '', category });
  const topic = getLearningTopicMetadata(topicId, 'path');
  const showTopic = fullPage && topicId !== 'uncategorized' && topicId !== 'other' && topic.label;

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
  const activeSequenceLabel = activeTrack?.label ?? t('coverPage.foundationsTab', 'Fundamentals');

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
      locked: milestone.isLocked,
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

  const totalEstimatedMinutes =
    activeMilestones.length > 0 && activeMilestones.every((m) => typeof m.estimatedMinutes === 'number')
      ? activeMilestones.reduce((sum, m) => sum + m.estimatedMinutes!, 0)
      : fullPage &&
          activeTabId === FOUNDATIONS_TAB_ID &&
          typeof estimatedMinutes === 'number' &&
          Number.isFinite(estimatedMinutes) &&
          estimatedMinutes > 0
        ? estimatedMinutes
        : undefined;

  const ctaProps = {
    'data-journey-start': 'true',
    'data-milestone-url': ctaTarget?.url,
    ...(ctaTarget?.id != null && { 'data-milestone-id': ctaTarget.id }),
    'data-interaction-location': progress === 0 ? 'get_started_cta' : 'resume_cta',
    'data-testid': testIds.learningPaths.tableOfContentsCta,
  };

  const heroContent = (
    <>
      {fullPage ? (
        <div className={fullPageStyles.heroHeading}>
          {showTopic && (
            <Link
              href={`${prefixRoute(ROUTES.Browse)}?${new URLSearchParams({ topic: topicId })}`}
              className={fullPageStyles.eyebrow}
            >
              <Icon name={topic.icon} size="sm" />
              {topic.label}
            </Link>
          )}
          <div className={fullPageStyles.titleRow}>
            {title && <h1 className={styles.heroTitle}>{title}</h1>}
            {organization && <Badge color="darkgrey" text={t('learningCard.organization', 'Your organization')} />}
          </div>
        </div>
      ) : (
        title && <h1 className={styles.heroTitle}>{title}</h1>
      )}
      {description && <p className={styles.heroDescription}>{description}</p>}
      {courseBadges.length > 0 && (
        <div className={fullPageStyles.courseBadges}>
          <span className={fullPageStyles.badgesLabel}>
            {t('coverPage.learningPathBadges', 'Learning path badges')}
          </span>
          <ul className={fullPageStyles.badgesList}>
            {courseBadges.map((courseBadge, index) => {
              const earnedAt = earnedBadges.find((earned) => earned.id === courseBadge.id)?.earnedAt;
              return (
                <li key={courseBadge.id} className={fullPageStyles.badgeItem}>
                  <BadgeGridItem
                    summary
                    badge={{ ...courseBadge, earnedAt }}
                    index={index}
                    selected={selectedBadgeId === courseBadge.id}
                    completedGuides={learningProgress?.completedGuides ?? []}
                    streakDays={learningProgress?.streakDays ?? 0}
                    paths={badgePaths}
                    styles={badgeStyles}
                    onSelect={(selected) => setSelectedBadgeId(selected.id)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {(!fullPage || totalEstimatedMinutes != null) && (
        <div className={styles.heroMeta}>
          {!fullPage && (
            <span className={styles.heroMetaItem}>
              <Icon name="list-ul" size="sm" />
              {milestoneCountText(activeMilestones.length)}
            </span>
          )}
          {totalEstimatedMinutes != null && (
            <span className={styles.heroMetaItem}>
              <Icon name="clock-nine" size="sm" />
              {totalEstimatedMinutes < 60
                ? t('coverPage.totalMinutes', '{{count}} min', { count: totalEstimatedMinutes })
                : t('coverPage.totalHours', '~{{count}} hr', { count: Math.round(totalEstimatedMinutes / 60) })}
            </span>
          )}
          {!fullPage && badge && (
            <span className={styles.heroMetaItem}>
              <BadgeIcon emoji={badge.emoji} icon={badge.icon} size="sm" />
              {t('coverPage.earnsBadge', 'Earns {{badge}} badge', { badge: badge.title })}
            </span>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      {(title || description || badge || courseBadges.length > 0) && (
        <div className={styles.hero} data-testid={testIds.learningPaths.coverHero}>
          {fullPage ? <div className={fullPageStyles.heroMain}>{heroContent}</div> : heroContent}
        </div>
      )}
      {hasTracks && (
        <>
          <TabsBar className={styles.tracksTabs} data-testid={testIds.learningPaths.tracksTabs}>
            <Tab
              className={fullPage ? fullPageStyles.trackTab : undefined}
              label={t('coverPage.foundationsTab', 'Fundamentals')}
              active={activeTabId === FOUNDATIONS_TAB_ID}
              onChangeTab={() => setActiveTabId(FOUNDATIONS_TAB_ID)}
              data-testid={testIds.learningPaths.tracksTab(FOUNDATIONS_TAB_ID)}
            />
            {tracks!.map((track) => (
              <Tab
                className={fullPage ? fullPageStyles.trackTab : undefined}
                key={track.trackId}
                label={track.label}
                active={activeTabId === track.trackId}
                onChangeTab={() => setActiveTabId(track.trackId)}
                data-testid={testIds.learningPaths.tracksTab(track.trackId)}
              />
            ))}
          </TabsBar>
        </>
      )}
      <div
        className={cx(styles.container, fullPage && !hasTracks && fullPageStyles.containerWithoutTabs)}
        data-testid={testIds.learningPaths.tableOfContents}
        // Testing contract: readable at 0%, where the ring below is hidden.
        // Unconditional — progress is synchronous (see the comment above), so
        // there is no "not loaded yet" window to gate on. See
        // E2E_TESTING_CONTRACT.md.
        data-test-path-percent={progress}
      >
        <div className={styles.header}>
          <div className={fullPage ? fullPageStyles.headingGroup : undefined}>
            <h2 className={styles.heading}>
              {!fullPage && <Icon name="list-ul" size="md" className={styles.headingIcon} />}
              {fullPage
                ? t('coverPage.milestonesInPath', '{{milestones}} in this path', {
                    milestones: milestoneCountText(activeMilestones.length),
                  })
                : t('coverPage.tableOfContents', 'In this path')}
            </h2>
          </div>
          <div className={styles.headerActions}>
            {!fullPage && progress > 0 && (
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
            {fullPage && (
              <div className={fullPageStyles.progressRow}>
                <div
                  className={fullPageStyles.progressTrack}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress)}
                  aria-label={t('coverPage.progressAriaLabel', '{{percent}}% through {{sequence}}', {
                    percent: Math.round(progress),
                    sequence: activeSequenceLabel,
                  })}
                >
                  <div className={fullPageStyles.progressFill} style={{ width: `${progress}%` }} />
                </div>
                <span className={fullPageStyles.progressLabel}>
                  {t('coverPage.percentComplete', '{{percent}}% complete', { percent: Math.round(progress) })}
                </span>
              </div>
            )}
            {ctaTarget &&
              (fullPage ? (
                <Button icon="play" {...ctaProps}>
                  {ctaLabel}
                </Button>
              ) : (
                <button type="button" className={styles.ctaButton} {...ctaProps}>
                  <Icon name="play" size="sm" />
                  {ctaLabel}
                </button>
              ))}
          </div>
        </div>
        <GuideList guides={guides} enableRowLinks fullPage={fullPage} />
      </div>
      {selectedBadgeWithStatus && (
        <BadgeDetailCard
          badge={selectedBadgeWithStatus}
          progress={selectedBadgeProgress}
          onClose={() => setSelectedBadgeId(null)}
        />
      )}
    </>
  );
}

const getFullPageStyles = (theme: GrafanaTheme2) => ({
  hero: css({
    padding: theme.spacing(3, 0, 0),
    margin: theme.spacing(0, 0, 4),
  }),
  heroMain: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1), minWidth: 0 }),
  courseBadges: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.25),
    maxWidth: '100%',
    marginTop: theme.spacing(1),
  }),
  badgesLabel: css({ ...theme.typography.base, color: theme.colors.text.primary }),
  badgesList: css({
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 0,
  }),
  badgeItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    ...theme.typography.base,
    color: theme.colors.text.primary,
  }),
  heroHeading: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5) }),
  titleRow: css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing(1.5) }),
  eyebrow: css({
    ...theme.typography.sm,
    color: theme.colors.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginBottom: 0,
    textDecoration: 'none',
    '&:hover': { color: theme.colors.text.secondary, textDecoration: 'underline' },
  }),
  heroTitle: css({
    ...theme.typography.h1,
    color: theme.colors.text.primary,
    margin: 0,
    border: 0,
    padding: 0,
  }),
  heroDescription: css({
    ...theme.typography.md,
    fontWeight: theme.typography.fontWeightRegular,
    color: theme.colors.text.secondary,
    maxWidth: '75ch',
    margin: 0,
  }),
  heroMeta: css({
    marginTop: theme.spacing(1),
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    ...theme.typography.base,
    color: theme.colors.text.secondary,
  }),
  headingGroup: css({
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    flex: '0 0 auto',
    maxWidth: '100%',
  }),
  headerActions: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(2), flexWrap: 'wrap' }),
  progressRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: theme.spacing(22),
    maxWidth: '100%',
  }),
  progressTrack: css({
    flex: 1,
    minWidth: 0,
    height: theme.spacing(0.5),
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.border.weak,
    overflow: 'hidden',
  }),
  progressFill: css({ height: '100%', background: theme.colors.success.main, borderRadius: theme.shape.radius.pill }),
  progressLabel: css({ ...theme.typography.sm, color: theme.colors.text.secondary, whiteSpace: 'nowrap' }),
  tracksTabs: css({ marginTop: 0 }),
  trackTab: css({ marginRight: theme.spacing(1) }),
  container: css({
    margin: theme.spacing(2, 0, 3),
    borderRadius: theme.shape.radius.lg,
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z3,
  }),
  containerWithoutTabs: css({ marginTop: 0 }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    padding: theme.spacing(2),
    marginBottom: 0,
  }),
  heading: css({
    ...theme.typography.md,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    margin: 0,
    color: theme.colors.text.primary,
  }),
});
