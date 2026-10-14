import { css, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

const arrive = keyframes({ from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } });

export const getCompletionPanelStyles = (theme: GrafanaTheme2) => ({
  panel: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    minWidth: 0,
    marginTop: theme.spacing(3),
    paddingTop: theme.spacing(3),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    '&:focus': { outline: `2px solid ${theme.colors.primary.main}`, outlineOffset: 4 },
  }),
  celebrating: css({
    animation: `${arrive} 260ms ease-out`,
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
  }),
  success: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1.5), minWidth: 0 }),
  check: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 42,
    height: 42,
    borderRadius: '50%',
    color: theme.colors.success.text,
    background: theme.colors.success.transparent,
    border: `1px solid ${theme.colors.success.border}`,
  }),
  heading: css({
    minWidth: 0,
    '& h2': { margin: 0, fontSize: 18, lineHeight: 1.4 },
    '& p': { margin: 0, color: theme.colors.text.secondary, overflowWrap: 'anywhere' },
  }),
  featured: css({
    padding: theme.spacing(2.5),
    borderRadius: 12,
    border: `1px solid ${theme.colors.primary.border}`,
    background: theme.isDark ? 'linear-gradient(120deg,#282553,#142d51)' : 'linear-gradient(120deg,#eeebff,#e6f0ff)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    minWidth: 0,
    '& h3': { margin: 0, fontSize: 22, lineHeight: 1.35, overflowWrap: 'anywhere' },
    '& p': { margin: 0, lineHeight: 1.6, color: theme.colors.text.secondary },
    '& button': { whiteSpace: 'normal', height: 'auto', minHeight: 32, textAlign: 'left' },
  }),
  eyebrow: css({ fontSize: 11, fontWeight: theme.typography.fontWeightMedium, color: theme.colors.text.secondary }),
  metadata: css({ fontSize: 12, color: theme.colors.text.secondary }),
  footer: css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing(1.5), minWidth: 0 }),
  suggestions: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1.5), minWidth: 0 }),
});
