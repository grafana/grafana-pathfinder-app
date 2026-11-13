import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getHelpFooterStyles = (theme: GrafanaTheme2) => ({
  compactFooter: css({
    marginTop: 'auto',
    padding: theme.spacing(1, 2, 1.5),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(0.75),
  }),
  compactLinks: css({
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: theme.spacing(0.25, 1.75),
  }),
  compactLink: css({
    '&&': {
      height: 'auto',
      minHeight: 0,
      padding: theme.spacing(0.25, 0),
      border: 0,
      background: 'transparent',
      color: theme.colors.text.secondary,
      fontSize: 11.5,
    },
    '&&:hover': {
      background: 'transparent',
      color: theme.colors.text.primary,
      textDecoration: 'underline',
    },
  }),
  compactVersion: css({
    fontSize: 10.5,
    lineHeight: 1.3,
    color: theme.colors.text.secondary,
    textAlign: 'center',
  }),
});
