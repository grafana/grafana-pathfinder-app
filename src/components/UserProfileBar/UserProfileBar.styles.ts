import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

const skeletonBase = (theme: GrafanaTheme2) => ({
  height: '16px',
  borderRadius: theme.shape.radius.default,
  backgroundColor: theme.colors.background.secondary,
  animation: 'pulse 1.5s ease-in-out infinite',
  '@keyframes pulse': {
    '0%, 100%': { opacity: 0.4 },
    '50%': { opacity: 0.8 },
  },
});

export const getUserProfileBarStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexWrap: 'wrap' as const,
  }),
  stat: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
  }),
  starEmoji: css({
    fontSize: '14px',
    lineHeight: 1,
    flexShrink: 0,
  }),
  fireEmoji: css({
    fontSize: '14px',
    lineHeight: 1,
    flexShrink: 0,
  }),
  bookIcon: css({
    color: theme.colors.primary.text,
    flexShrink: 0,
  }),
  statValue: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  nextAction: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginLeft: 'auto',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.link,
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.radius.default,
    transition: 'background-color 0.2s ease',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '50%',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      textDecoration: 'underline',
    },
  }),
  nextActionLabel: css({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  allComplete: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginLeft: 'auto',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.success.text,
    whiteSpace: 'nowrap',
  }),
  skeleton: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  skeletonBlock: css({
    ...skeletonBase(theme),
    width: '48px',
  }),
  skeletonBlockWide: css({
    ...skeletonBase(theme),
    width: '96px',
  }),
});
