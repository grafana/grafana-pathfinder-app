/**
 * Home page layout styles
 *
 * Minimal container style for the full-page wrapper.
 * MyLearningTab handles its own internal layout.
 */

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getHomePageStyles = (theme: GrafanaTheme2) => {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      padding: theme.spacing(3),
      maxWidth: 960,
      margin: '0 auto',
      width: '100%',
    }),
    adminLink: css({
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
      marginBottom: theme.spacing(2),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      textDecoration: 'none',
      alignSelf: 'flex-end',
      '&:hover': {
        color: theme.colors.text.primary,
        background: theme.colors.action.hover,
      },
    }),
  };
};
