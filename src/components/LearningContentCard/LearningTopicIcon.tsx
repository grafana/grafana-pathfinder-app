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
  bordered = false,
  surface = 'secondary',
}: {
  topic?: string;
  kind?: 'guide' | 'path' | 'docs';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  bordered?: boolean;
  surface?: 'hover' | 'page' | 'canvas' | 'secondary';
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
          background: bordered
            ? surface === 'hover'
              ? theme.colors.action.hover
              : theme.colors.background[surface]
            : visual.background,
          border: `1px solid ${bordered ? theme.colors.border.weak : visual.border}`,
          outline: bordered ? `1px solid ${theme.colors.border.weak}` : undefined,
          outlineOffset: bordered ? theme.spacing(0.25) : undefined,
          borderRadius: bordered ? theme.shape.radius.sm : size === 'lg' ? 15 : 10,
          '& svg': {
            width: size === 'lg' ? 28 : size === 'sm' ? 18 : 21,
            height: size === 'lg' ? 28 : size === 'sm' ? 18 : 21,
          },
          '@container (max-width: 340px)':
            size === 'md' ? { width: 30, height: 30, '& svg': { width: 18, height: 18 } } : {},
        }),
      };
    },
    [topic, kind, size, bordered, surface]
  );
  const styles = useStyles2(getStyles);
  return (
    <span className={cx(styles.tile, className)} data-learning-topic-icon aria-hidden="true">
      <Icon name={getLearningTopicMetadata(topic, kind).icon} />
    </span>
  );
}
