import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { createSecondaryButton } from './button-utils';

export const getHelpFooterStyles = (theme: GrafanaTheme2) => ({
  helpFooter: css({
    marginTop: 'auto',
    padding: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.canvas,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  }),
  helpButtons: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: theme.spacing(0.75),
    width: '100%',

    // Stack vertically when width is too small
    '@media (max-width: 400px)': {
      gridTemplateColumns: '1fr',
    },
  }),
  helpButton: css([
    createSecondaryButton(theme, { size: 'sm' }),
    {
      '&&': {
        // Double ampersand increases specificity to override createButtonBase
        justifyContent: 'flex-start',
        textAlign: 'left',
      },
      textDecoration: 'none',
      minHeight: '32px',
    },
  ]),
  helpButtonContent: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
    minWidth: 0,
  }),
  helpButtonIcon: css({
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
  helpButtonText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightRegular,
    color: theme.colors.text.primary,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
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
  versionInfo: css({
    display: 'flex',
    justifyContent: 'center',
    paddingTop: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  versionText: css({
    fontSize: '11px',
    color: theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeightRegular,
    textAlign: 'center',
    lineHeight: 1.3,
  }),
});
