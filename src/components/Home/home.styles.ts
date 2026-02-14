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
  };
};
