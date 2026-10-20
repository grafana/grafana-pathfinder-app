import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export const getSidebarHubStyles = (theme: GrafanaTheme2) => {
  const accent = theme.colors.warning;
  const focusRing = {
    '&:focus-visible': { outline: `2px solid ${theme.colors.primary.main}`, outlineOffset: 2 },
  };

  return {
    header: css({
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      flexWrap: 'wrap',
    }),
    greeting: css({ minWidth: 0, flex: '1 1 160px', overflowWrap: 'anywhere' }),
    myLearning: css({
      borderRadius: theme.shape.radius.pill,
      '& svg': { color: accent.text },
      '&:hover': { borderColor: accent.border, background: accent.transparent },
    }),
    denseCard: css({
      gridTemplate:
        '"Figure Heading Secondary" "Figure Meta Secondary" ". Actions Actions" "Description Description Description" / auto 1fr auto',
      alignItems: 'center',
    }),
    denseAction: css({ marginTop: 0 }),
    denseToggle: css({ position: 'relative', marginTop: 0 }),
    denseDetails: css({ position: 'relative', cursor: 'default', marginTop: theme.spacing(0.5) }),
    noWrap: css({ whiteSpace: 'nowrap' }),
    denseHeading: css({ minWidth: 0, overflowWrap: 'anywhere' }),
    play: css({
      display: 'grid',
      placeItems: 'center',
      width: 26,
      height: 26,
      borderRadius: theme.shape.radius.circle,
      background: accent.transparent,
      color: accent.text,
    }),
    ringFigure: css({ width: 'auto' }),
    resume: css({
      background: `radial-gradient(circle at 100% -20%, ${accent.transparent}, transparent 60%), ${theme.colors.background.secondary}`,
    }),
    tile: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 2,
      minWidth: 0,
      minHeight: 72,
      padding: theme.spacing(1, 1.25),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      color: theme.colors.text.primary,
      textAlign: 'left',
      cursor: 'pointer',
      '&:hover': { borderColor: theme.colors.border.medium, background: theme.colors.action.hover },
      ...focusRing,
    }),
    tileAccent: css({
      borderColor: accent.border,
      background: accent.transparent,
      '&:hover': { borderColor: accent.main, background: accent.transparent },
    }),
    tileCount: css({
      fontSize: theme.typography.h2.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      lineHeight: 1.1,
    }),
    tileLabel: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      overflowWrap: 'anywhere',
    }),
    tileCaption: css({ color: accent.text, fontSize: 11, fontWeight: theme.typography.fontWeightMedium }),
    sectionHeader: css({
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      marginBottom: theme.spacing(0.75),
    }),
    list: css({
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.75),
    }),
  };
};
