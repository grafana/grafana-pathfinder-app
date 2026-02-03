/**
 * Block JSON Editor Styles
 *
 * Theme-aware styles for the JSON editor component.
 */

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: theme.spacing(1),
  }),

  errorList: css({
    margin: 0,
    paddingLeft: theme.spacing(2),
  }),

  editorContainer: css({
    flex: 1,
    minHeight: 0,
    // CodeEditor needs explicit height, use 100% of remaining flex space
    '& > div': {
      height: '100%',
    },
  }),
});
