import { ProgressRing } from '../LearningPaths/ProgressRing';
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { cx } from '@emotion/css';
import { LearningDetailsToggle } from './LearningDetailsToggle';
import { LearningTopicIcon } from './LearningTopicIcon';
import { getLearningAction } from './learning-action';
import { getLearningTopicMetadata } from './learning-topic-visual';
import { getLearningContentCardStyles } from './learning-content-card.styles';

export interface LearningContentCardProps {
  title: string;
  tile?: boolean;
  onViewPath?: () => void;
  variant?: 'compact' | 'featured' | 'completion-primary' | 'completion-alternative';
  eyebrow?: string;
  expandableDescription?: boolean;
  actionAtBottom?: boolean;
  topic?: string;
  kind: 'guide' | 'path' | 'docs';
  description?: string;
  effort?: React.ReactNode;
  organization?: boolean;
  progress?: number;
  badges?: React.ReactNode;
  actionLabel?: string;
  actionAriaLabel?: string;
  onLaunch: () => void | Promise<void>;
  launching?: boolean;
  launchDisabled?: boolean;
  launchError?: string;
  expanded?: boolean;
  onToggleDetails?: () => void;
  details?: React.ReactNode;
  disclosureLabel?: string;
  collapseLabel?: string;
  testId?: string;
  titleTestId?: string;
  actionTestId?: string;
  disclosureTestId?: string;
  detailsTestId?: string;
  actionRef?: React.Ref<HTMLButtonElement>;
}

const FEATURED_DESCRIPTION_LINES = 4;

export function LearningContentCard({
  title,
  tile = false,
  onViewPath,
  variant = 'compact',
  eyebrow,
  expandableDescription = false,
  actionAtBottom = false,
  topic,
  kind,
  description,
  effort,
  organization,
  progress,
  badges,
  onLaunch,
  actionLabel,
  actionAriaLabel,
  launching = false,
  launchDisabled = false,
  launchError,
  expanded,
  onToggleDetails,
  details,
  disclosureLabel,
  collapseLabel,
  testId,
  titleTestId,
  actionTestId,
  disclosureTestId,
  detailsTestId,
  actionRef,
}: LearningContentCardProps) {
  const styles = useStyles2(getLearningContentCardStyles);
  const completion = variant === 'completion-primary' || variant === 'completion-alternative';
  const featured = variant === 'featured' || variant === 'completion-primary';
  const spacious = featured || completion;
  const topicMetadata = getLearningTopicMetadata(topic, kind);
  const topicLabel = topicMetadata.label;
  const detailsId = useId();
  const [localExpanded, setLocalExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const lock = useRef(false);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const element = descriptionRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const style = getComputedStyle(element);
      const lineHeight =
        parseFloat(style.lineHeight) * (style.lineHeight.endsWith('px') ? 1 : parseFloat(style.fontSize));
      const lines = featured ? FEATURED_DESCRIPTION_LINES : 2;
      setTruncated(
        !completion && (!featured || expandableDescription) && element.scrollHeight > lineHeight * lines + 1
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description, completion, featured, expandableDescription]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isExpanded = expanded ?? localExpanded;
  const canExpand = tile ? Boolean(onViewPath) : Boolean(!completion && (details || truncated));
  const percent = typeof progress === 'number' && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
  const action = getLearningAction(kind, percent);
  const label =
    action === 'read'
      ? t('learningCard.read', 'Read')
      : action === 'review'
        ? t('learningCard.review', 'Review')
        : action === 'resume'
          ? t('learningCard.resume', 'Resume')
          : kind === 'path'
            ? t('learningCard.startPath', 'Start path')
            : t('learningCard.startGuide', 'Start guide');
  const launch = () => {
    if (lock.current || launching || launchDisabled) {
      return;
    }
    lock.current = true;
    setError(false);
    try {
      const result = onLaunch();
      if (result && typeof result.then === 'function') {
        setPending(true);
        void result
          .catch(() => {
            if (mounted.current) {
              setError(true);
            }
          })
          .finally(() => {
            lock.current = false;
            if (mounted.current) {
              setPending(false);
            }
          });
      } else {
        lock.current = false;
      }
    } catch {
      lock.current = false;
      setError(true);
    }
  };

  const bottomAction = tile || (featured && actionAtBottom);
  const launchButton = (
    <Button
      ref={actionRef}
      aria-label={actionAriaLabel}
      variant={featured ? 'primary' : 'secondary'}
      className={bottomAction ? undefined : styles.action}
      size={bottomAction ? 'md' : 'sm'}
      fullWidth={bottomAction && !tile}
      icon={kind === 'docs' ? 'file-alt' : 'play'}
      disabled={launchDisabled || launching || pending}
      onClick={launch}
      data-testid={actionTestId}
    >
      {launching || pending ? t('learningCard.opening', 'Opening…') : (actionLabel ?? label)}
    </Button>
  );
  const viewDetails = () =>
    tile ? onViewPath?.() : onToggleDetails ? onToggleDetails() : setLocalExpanded((value) => !value);
  const toggle = canExpand && !tile && (
    <LearningDetailsToggle
      expanded={isExpanded}
      hasDetails={Boolean(details)}
      label={disclosureLabel}
      collapseLabel={collapseLabel}
      controls={detailsId}
      subtle={bottomAction}
      testId={disclosureTestId}
      onToggle={viewDetails}
    />
  );
  const progressLabel = percent > 0 && (
    <span className={cx(styles.progress, percent === 100 && styles.completed)}>
      {percent === 100
        ? t('learningCard.completed', 'Completed')
        : t('learningCard.progress', '{{percent}}% complete', { percent })}
    </span>
  );

  if (tile) {
    return (
      <article
        className={cx(styles.card, styles.tile)}
        data-testid={testId}
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest('button, a, input')) {
            onViewPath?.();
          }
        }}
      >
        <div className={styles.tileBody}>
          <div className={styles.tileTopic}>
            <LearningTopicIcon topic={topic} kind={kind} size="sm" bordered surface="secondary" />
          </div>
          <div className={styles.tileHeading}>
            <h3 data-testid={titleTestId}>
              <button type="button" className={styles.titleButton} onClick={onViewPath}>
                {title}
              </button>
            </h3>
          </div>
          {description && <p className={styles.tileDescription}>{description}</p>}
          {badges && <div className={styles.badges}>{badges}</div>}
        </div>
        <div className={styles.tileProgress}>
          {kind !== 'docs' && (
            <ProgressRing progress={percent} size={40} strokeWidth={3} isCompleted={percent === 100} showPercentage />
          )}
          <span className={styles.tileMetadata}>
            {effort}
            {organization && (
              <>
                {effort ? ' · ' : ''}
                {t('learningCard.organization', 'Your organization')}
              </>
            )}
          </span>
        </div>
        <div className={styles.tileActions}>{launchButton}</div>
        {(launchError || error) && (
          <p role="alert" className={styles.error}>
            {launchError || t('learningCard.launchError', 'Could not open this content. Try again.')}
          </p>
        )}
      </article>
    );
  }

  return (
    <article
      className={cx(styles.card, tile && styles.tile, completion && styles.completion, featured && styles.featured)}
      data-testid={testId}
    >
      {!spacious && <LearningTopicIcon topic={topic} kind={kind} />}
      <div className={styles.content}>
        {spacious ? (
          <div className={styles.featuredHeader}>
            <LearningTopicIcon topic={topic ?? 'getting-started'} kind={kind} size="lg" />
            <div className={styles.featuredHeading}>
              <div className={styles.eyebrow}>
                {eyebrow ?? t('learningCard.starterEyebrow', 'A good place to start')}
              </div>
              <h3 data-testid={titleTestId}>
                {tile && canExpand ? (
                  <button type="button" className={styles.titleButton} onClick={viewDetails}>
                    {title}
                  </button>
                ) : (
                  title
                )}
              </h3>
              {badges && <div className={styles.badges}>{badges}</div>}
            </div>
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <div className={styles.heading}>
                <h3 data-testid={titleTestId}>
                  {tile && canExpand ? (
                    <button type="button" className={styles.titleButton} onClick={viewDetails}>
                      {title}
                    </button>
                  ) : (
                    title
                  )}
                </h3>
              </div>
              {!tile && launchButton}
            </div>
            <div className={styles.badges}>
              <span
                className={cx(
                  styles.kind,
                  kind === 'guide' ? styles.guide : kind === 'path' ? styles.path : styles.docs
                )}
              >
                {kind === 'guide'
                  ? t('learningCard.guide', 'Guide')
                  : kind === 'path'
                    ? t('learningCard.path', 'Learning path')
                    : t('learningCard.docs', 'Documentation')}
              </span>
              {topicLabel && (
                <>
                  <span aria-hidden="true" className={styles.separator}>
                    ·
                  </span>
                  <span className={styles.topicLabel}>{topicLabel}</span>
                </>
              )}
              {organization && (
                <>
                  <span aria-hidden="true" className={styles.separator}>
                    ·
                  </span>
                  <span className={styles.metadata}>{t('learningCard.organization', 'Your organization')}</span>
                </>
              )}
              {badges}
            </div>
          </>
        )}
        {description && (
          <p
            ref={descriptionRef}
            id={!details ? detailsId : undefined}
            data-testid={isExpanded && !details ? detailsTestId : undefined}
            className={cx(
              styles.description,
              spacious && styles.featuredDescription,
              !isExpanded && !completion && (featured ? expandableDescription && styles.featuredClamp : styles.excerpt)
            )}
          >
            {description}
          </p>
        )}
        {spacious ? (
          bottomAction ? null : (
            <div className={styles.featuredFooter}>
              {effort && <div className={styles.metadata}>{effort}</div>}
              {launchButton}
            </div>
          )
        ) : (
          !bottomAction && effort && <div className={styles.metadata}>{effort}</div>
        )}
        {bottomAction
          ? (effort || canExpand || percent > 0) && (
              <div className={styles.featuredMeta}>
                {effort && <div className={styles.metadata}>{effort}</div>}
                {toggle}
                {progressLabel}
              </div>
            )
          : (canExpand || percent > 0) && (
              <div className={styles.footer}>
                {toggle}
                {progressLabel}
              </div>
            )}
        {details && isExpanded && !tile && (
          <div id={detailsId} className={styles.details} data-testid={detailsTestId}>
            {details}
          </div>
        )}
        {bottomAction && launchButton}
        {(launchError || error) && (
          <div className={styles.error} role="alert">
            <p>{launchError || t('learningCard.launchError', 'Could not open this content. Try again.')}</p>
            <Button size="sm" variant="secondary" disabled={pending || launching || launchDisabled} onClick={launch}>
              {t('learningCard.retry', 'Retry')}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
