import React, { useCallback, useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Icon, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

import type { LearningPreview } from './learning-previews';
import { getLearningTopicMetadata, getLearningTopicVisual } from './learning-topic-visual';

export function LearningCardPreview({
  preview,
  topic,
  kind = 'guide',
  estimatedMinutes,
  organization = false,
  className,
}: {
  preview?: Pick<LearningPreview, 'src' | 'alt'>;
  topic?: string;
  kind?: 'guide' | 'path' | 'docs';
  estimatedMinutes?: number;
  organization?: boolean;
  className?: string;
}) {
  const getPreviewStyles = useCallback((theme: GrafanaTheme2) => getStyles(theme, topic, kind), [topic, kind]);
  const styles = useStyles2(getPreviewStyles);
  const [failedSrc, setFailedSrc] = useState<string>();

  return (
    <div className={cx(styles.frame, className)} data-learning-card-preview>
      {preview && preview.src !== failedSrc ? (
        <img
          className={styles.image}
          src={preview.src}
          alt={preview.alt}
          loading="lazy"
          onError={() => setFailedSrc(preview.src)}
        />
      ) : (
        <Icon name={getLearningTopicMetadata(topic, kind).icon} className={styles.fallbackIcon} aria-hidden="true" />
      )}
      {organization && (
        <Badge
          color="darkgrey"
          text={t('learningCard.organization', 'Your organization')}
          className={styles.organizationBadge}
        />
      )}
      {typeof estimatedMinutes === 'number' && Number.isFinite(estimatedMinutes) && estimatedMinutes > 0 && (
        <Badge color="darkgrey" text={`${estimatedMinutes} min`} className={styles.durationBadge} />
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2, topic: string | undefined, kind: 'guide' | 'path' | 'docs') => ({
  frame: css({
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    width: `calc(100% - ${theme.spacing(1)})`,
    margin: theme.spacing(0.5, 0.5, 0),
    flexShrink: 0,
    aspectRatio: '16 / 9',
    overflow: 'hidden',
    borderRadius: `calc(${theme.shape.radius.lg} - ${theme.spacing(0.5)} - 1px)`,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    color: getLearningTopicVisual(topic, theme, kind).color,
  }),
  image: css({
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'top left',
  }),
  fallbackIcon: css({
    width: theme.spacing(5),
    height: theme.spacing(5),
  }),
  durationBadge: css({
    position: 'absolute',
    bottom: theme.spacing(1),
    right: theme.spacing(1),
  }),
  organizationBadge: css({
    position: 'absolute',
    bottom: theme.spacing(1),
    left: theme.spacing(1),
  }),
});
