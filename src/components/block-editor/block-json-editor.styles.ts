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

  toolbar: css({
    display: 'flex',
    justifyContent: 'flex-end',
    padding: theme.spacing(1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.secondary,
  }),

  errorList: css({
    margin: 0,
    paddingLeft: theme.spacing(2),
  }),

  editorContainer: css({
    flex: 1,
    // Minimum height ensures visibility when parent height is not explicit
    minHeight: '400px',
    // Use relative positioning to establish containing block for absolute child
    position: 'relative',
    // CodeEditor wrapper needs absolute positioning to fill flex container
    // (percentage heights don't resolve in flex children without explicit height)
    '& > div': {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
  }),
});
