import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { cx } from '@emotion/css';
import { LearningTopicIcon } from './LearningTopicIcon';
import { getLearningTopicMetadata } from './learning-topic-visual';
import { getLearningContentCardStyles } from './learning-content-card.styles';

export interface LearningContentCardProps {
  title: string;
  variant?: 'compact' | 'featured';
  topic?: string;
  kind: 'guide' | 'path' | 'docs';
  description?: string;
  effort?: React.ReactNode;
  organization?: boolean;
  progress?: number;
  badges?: React.ReactNode;
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

export function LearningContentCard({
  title,
  variant = 'compact',
  topic,
  kind,
  description,
  effort,
  organization,
  progress,
  badges,
  onLaunch,
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
  const featured = variant === 'featured';
  const topicLabel = getLearningTopicMetadata(topic, kind).label;
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
      setTruncated(!featured && element.scrollHeight > lineHeight * 2 + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description, featured]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isExpanded = expanded ?? localExpanded;
  const canExpand = Boolean(details || truncated);
  const percent = typeof progress === 'number' && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
  const label =
    kind === 'docs'
      ? t('learningCard.read', 'Read')
      : percent === 100
        ? t('learningCard.review', 'Review')
        : percent > 0
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

  const launchButton = (
    <Button
      ref={actionRef}
      className={styles.action}
      size="sm"
      icon={kind === 'docs' ? 'file-alt' : 'play'}
      disabled={launchDisabled || launching || pending}
      onClick={launch}
      data-testid={actionTestId}
    >
      {launching || pending ? t('learningCard.opening', 'Opening…') : label}
    </Button>
  );

  return (
    <article className={cx(styles.card, featured && styles.featured)} data-testid={testId}>
      {!featured && <LearningTopicIcon topic={topic} kind={kind} />}
      <div className={styles.content}>
        {featured ? (
          <div className={styles.featuredHeader}>
            <LearningTopicIcon topic="getting-started" size="lg" />
            <div className={styles.featuredHeading}>
              <div className={styles.eyebrow}>{t('learningCard.starterEyebrow', 'A good place to start')}</div>
              <h3 data-testid={titleTestId}>{title}</h3>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <div className={styles.heading}>
                <h3 data-testid={titleTestId}>{title}</h3>
              </div>
              {launchButton}
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
              featured && styles.featuredDescription,
              !isExpanded && !featured && styles.excerpt
            )}
          >
            {description}
          </p>
        )}
        {featured ? (
          <div className={styles.featuredFooter}>
            {effort && <div className={styles.metadata}>{effort}</div>}
            {launchButton}
          </div>
        ) : (
          effort && <div className={styles.metadata}>{effort}</div>
        )}
        {(canExpand || percent > 0) && (
          <div className={styles.footer}>
            {canExpand && (
              <button
                className={styles.disclosure}
                aria-expanded={isExpanded}
                aria-controls={detailsId}
                data-testid={disclosureTestId}
                onClick={() => (onToggleDetails ? onToggleDetails() : setLocalExpanded((value) => !value))}
              >
                {isExpanded
                  ? collapseLabel ||
                    (details ? t('learningCard.hideDetails', 'Hide details') : t('learningCard.showLess', 'Show less'))
                  : disclosureLabel ||
                    (details ? t('learningCard.details', 'Details') : t('learningCard.readMore', 'Read more'))}
                <Icon name={isExpanded ? 'angle-up' : 'angle-down'} size="sm" />
              </button>
            )}
            {percent > 0 && (
              <span className={cx(styles.progress, percent === 100 && styles.completed)}>
                {percent === 100
                  ? t('learningCard.completed', 'Completed')
                  : t('learningCard.progress', '{{percent}}% complete', { percent })}
              </span>
            )}
          </div>
        )}
        {details && isExpanded && (
          <div id={detailsId} className={styles.details} data-testid={detailsTestId}>
            {details}
          </div>
        )}
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
