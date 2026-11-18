import { moduleCountText } from '../LearningContentCard/learning-effort';
import { getLearningTopicMetadata } from '../LearningContentCard/learning-topic-visual';
import { LearningCardPreview } from '../LearningContentCard/LearningCardPreview';
import { getLearningPreview } from '../LearningContentCard/learning-previews';
import { catalogTopic } from '../../lib/catalog-discovery';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';
import React, { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useStyles2, Icon, TabsBar, Tab, Button, Badge, Combobox, InlineLabel, Link } from '@grafana/ui';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';

import type { CoverPageTrack, Milestone } from '../../types/content.types';
import type { PathGuide } from '../../types/learning-paths.types';
import { FOUNDATIONS_TRACK_ID } from '../../types/package.types';
import { journeyMilestonePercentages, percentagesToProgress } from '../../docs-retrieval';
import { getGuideProgressRevision, subscribeGuideProgressRevision } from '../../global-state/progress-events';
import { testIds } from '../../constants/testIds';
import { findPathByUrl, getBadgeForPath } from '../../learning-paths';
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
   * way `milestones` is. The full-page dropdown and compact tabs include each
   * track alongside the default sequence (`milestones`).
   */
  tracks?: CoverPageTrack[];
  /**
   * Notified whenever the selected track changes, including once on
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
  renderSections?: (header: React.ReactNode, modules: React.ReactNode) => React.ReactNode;
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
  renderSections,
}: LearningPathTableOfContentsProps) {
  const compactStyles = useStyles2(getTableOfContentsStyles);
  const fullPageStyles = useStyles2(getFullPageStyles);
  const trackControlId = useId();
  const styles = fullPage ? { ...compactStyles, ...fullPageStyles } : compactStyles;
  const badge = !fullPage && pathId ? getBadgeForPath(pathId) : undefined;
  const topicId = catalogTopic({ id: pathId ?? '', title: title ?? '', category });
  const topic = getLearningTopicMetadata(topicId, 'path');
  const showTopic = fullPage && topicId !== 'uncategorized' && topicId !== 'other' && topic.label;
  const previewId = fullPage && !organization ? (pathId ?? findPathByUrl(baseUrl)?.id) : undefined;

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
  const altitudeLabel = t('coverPage.altitudeLabel', 'Altitude');
  const altitudeTracks = [...(tracks ?? [])];
  const sellerIndex = altitudeTracks.findIndex((track) => track.trackId === 'seller');
  const engineerIndex = altitudeTracks.findIndex((track) => track.trackId === 'engineer');
  if (engineerIndex >= 0 && sellerIndex > engineerIndex) {
    const [seller] = altitudeTracks.splice(sellerIndex, 1);
    altitudeTracks.splice(engineerIndex, 0, seller!);
  }

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
      {(!fullPage || totalEstimatedMinutes != null) && (
        <div className={styles.heroMeta}>
          {!fullPage && (
            <span className={styles.heroMetaItem}>
              <Icon name="list-ul" size="sm" />
              {moduleCountText(activeMilestones.length)}
            </span>
          )}
          {totalEstimatedMinutes != null && (
            <span className={styles.heroMetaItem}>
              <Icon name="clock-nine" size={fullPage ? 'md' : 'sm'} />
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

  const showHeroContent = Boolean(title || description || badge);

  const header = (
    <>
      {(showHeroContent || (fullPage && hasTracks)) && (
        <div
          className={cx(styles.hero, renderSections && fullPageStyles.heroWithTabs)}
          data-testid={testIds.learningPaths.coverHero}
        >
          {fullPage ? (
            <>
              {showHeroContent && (
                <>
                  <LearningCardPreview
                    kind="path"
                    topic={topicId}
                    preview={previewId ? getLearningPreview(previewId) : undefined}
                    className={fullPageStyles.heroPreview}
                  />
                  <div className={fullPageStyles.heroMain}>{heroContent}</div>
                </>
              )}
              {hasTracks && (
                <div className={fullPageStyles.trackFilter}>
                  <InlineLabel width="auto" htmlFor={trackControlId} className={fullPageStyles.trackFilterLabel}>
                    {altitudeLabel}
                  </InlineLabel>
                  <Combobox
                    id={trackControlId}
                    aria-label={altitudeLabel}
                    width="auto"
                    minWidth={12}
                    maxWidth={24}
                    value={activeTrack?.trackId ?? FOUNDATIONS_TAB_ID}
                    options={[
                      {
                        value: FOUNDATIONS_TAB_ID,
                        label: t('coverPage.defaultTrack', 'Fundamentals (default)'),
                      },
                      ...altitudeTracks.map((track) => ({ value: track.trackId, label: track.label })),
                    ]}
                    onChange={(option) => setActiveTabId(option.value)}
                  />
                </div>
              )}
            </>
          ) : (
            heroContent
          )}
        </div>
      )}
      {hasTracks && !fullPage && (
        <TabsBar className={compactStyles.tracksTabs} data-testid={testIds.learningPaths.tracksTabs}>
          <Tab
            label={t('coverPage.foundationsTab', 'Fundamentals')}
            active={activeTabId === FOUNDATIONS_TAB_ID}
            onChangeTab={() => setActiveTabId(FOUNDATIONS_TAB_ID)}
            data-testid={testIds.learningPaths.tracksTab(FOUNDATIONS_TAB_ID)}
          />
          {tracks.map((track) => (
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
    </>
  );

  const modules = (
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
        <div className={fullPage ? fullPageStyles.headingGroup : undefined}>
          <h2 className={styles.heading}>
            {!fullPage && <Icon name="list-ul" size="md" className={styles.headingIcon} />}
            {fullPage
              ? t('coverPage.modulesInPath', '{{modules}} in this path', {
                  modules: moduleCountText(activeMilestones.length),
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
  );

  return renderSections ? (
    renderSections(header, modules)
  ) : (
    <>
      {header}
      {modules}
    </>
  );
}

const getFullPageStyles = (theme: GrafanaTheme2) => ({
  hero: css({
    display: 'flex',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: theme.spacing(2, 3),
    padding: theme.spacing(3, 0, 0),
    margin: theme.spacing(0, 0, 5),
  }),
  heroWithTabs: css({ marginBottom: theme.spacing(3) }),
  heroMain: css({
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 280px',
    gap: theme.spacing(1),
    minWidth: 0,
    paddingTop: theme.spacing(1),
  }),
  heroPreview: css({
    width: theme.spacing(27),
    maxWidth: '100%',
    margin: 0,
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
    ...theme.typography.xxl,
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
    alignItems: 'center',
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
  trackFilter: css({
    display: 'flex',
    marginLeft: 'auto',
    minWidth: 0,
    maxWidth: '100%',
    '& input': { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
  }),
  trackFilterLabel: css({
    marginRight: 0,
    border: `1px solid ${theme.components.input.borderColor}`,
    borderRadius: `${theme.shape.radius.default} 0 0 ${theme.shape.radius.default}`,
    position: 'relative',
    right: -1,
  }),
  container: css({
    margin: theme.spacing(0, 0, 3),
    borderRadius: theme.shape.radius.lg,
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z1,
  }),
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
