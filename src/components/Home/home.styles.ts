/**
 * Home page layout styles
 *
 * Theme-aware styles for the home page container, header, and grid.
 * Card-specific styles live in path-card.styles.ts.
 */

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getHomePageStyles = (theme: GrafanaTheme2) => {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      maxWidth: 960,
      margin: '0 auto',
      width: '100%',
    }),
    header: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    title: css({
      margin: 0,
      fontSize: theme.typography.h3.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),
    subtitle: css({
      margin: 0,
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.5,
    }),
    pathsGrid: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
  };
};
