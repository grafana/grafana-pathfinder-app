import React, { useCallback } from 'react';
import { Icon, useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import { css, cx } from '@emotion/css';
import { getLearningTopicMetadata, getLearningTopicVisual } from './learning-topic-visual';

export function LearningTopicIcon({
  topic,
  kind = 'guide',
  size = 'md',
  className,
}: {
  topic?: string;
  kind?: 'guide' | 'path' | 'docs';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const getStyles = useCallback(
    (theme: GrafanaTheme2) => {
      const visual = getLearningTopicVisual(topic, theme, kind);
      const dimension = size === 'sm' ? 32 : size === 'lg' ? 50 : 38;
      return {
        tile: css({
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          width: dimension,
          height: dimension,
          color: visual.color,
          background: visual.background,
          border: `1px solid ${visual.border}`,
          borderRadius: size === 'lg' ? 15 : 10,
          '& svg': {
            width: size === 'lg' ? 28 : size === 'sm' ? 18 : 21,
            height: size === 'lg' ? 28 : size === 'sm' ? 18 : 21,
          },
          '@container (max-width: 340px)':
            size === 'md' ? { width: 30, height: 30, '& svg': { width: 18, height: 18 } } : {},
        }),
      };
    },
    [topic, kind, size]
  );
  const styles = useStyles2(getStyles);
  return (
    <span className={cx(styles.tile, className)} aria-hidden="true">
      <Icon name={getLearningTopicMetadata(topic, kind).icon} />
    </span>
  );
}
