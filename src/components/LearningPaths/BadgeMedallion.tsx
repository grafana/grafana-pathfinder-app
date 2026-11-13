import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2 } from '@grafana/ui';

import type { EarnedBadge } from '../../types';
import { BadgeIcon } from './BadgeIcon';

export function BadgeMedallion({ badge, size = 'sm' }: { badge: EarnedBadge; size?: 'sm' | 'lg' }) {
  const styles = useStyles2(getStyles);
  const earned = Boolean(badge.earnedAt);
  return (
    <span
      aria-hidden="true"
      className={cx(styles.circle, size === 'lg' && styles.large, earned ? styles.earned : styles.unearned)}
    >
      <BadgeIcon
        emoji={badge.emoji}
        icon={badge.icon}
        size={size === 'lg' ? 'xxxl' : 'xl'}
        emojiClassName={cx(styles.emoji, !earned && styles.unearnedIcon)}
        iconClassName={!earned ? styles.unearnedIcon : undefined}
      />
      {badge.isLegacy && (
        <span className={styles.legacy}>
          <Icon name="history" size="xs" />
        </span>
      )}
    </span>
  );
}

const getStyles = (theme: GrafanaTheme2) => {
  const successGreen = '#22C55E';
  return {
    circle: css({
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      width: theme.spacing(6),
      height: theme.spacing(6),
      borderRadius: theme.shape.radius.circle,
      background: theme.colors.background.secondary,
      color: theme.colors.text.secondary,
      fontSize: theme.typography.xl.fontSize,
    }),
    large: css({ width: theme.spacing(11), height: theme.spacing(11), fontSize: theme.typography.pxToRem(36) }),
    earned: css({
      background: `linear-gradient(135deg, ${successGreen}40 0%, ${successGreen}15 100%)`,
      border: `2px solid ${successGreen}`,
      boxShadow: `0 0 8px rgb(from ${successGreen} r g b / 20%), 0 0 16px rgb(from ${successGreen} r g b / 12%)`,
      '& > svg': { color: successGreen, filter: `drop-shadow(0 0 3px rgb(from ${successGreen} r g b / 40%))` },
    }),
    unearned: css({ border: `1px dashed ${theme.colors.border.medium}` }),
    unearnedIcon: css({ opacity: 0.4, filter: 'grayscale(1)' }),
    emoji: css({ fontSize: 'inherit', lineHeight: 1 }),
    legacy: css({
      position: 'absolute',
      bottom: 0,
      right: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: theme.spacing(2),
      height: theme.spacing(2),
      borderRadius: theme.shape.radius.circle,
      background: theme.colors.background.secondary,
      color: theme.colors.text.secondary,
    }),
  };
};
