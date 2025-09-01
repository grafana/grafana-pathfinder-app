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
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: theme.spacing(0.75),
    width: '100%',
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

      // Override the default secondary button hover to be more subtle
      '&:hover:not(:disabled)': {
        backgroundColor: theme.colors.action.hover,
        borderColor: theme.colors.border.medium,
        transform: 'translateY(-1px)',
        boxShadow: theme.shadows.z1,
        textDecoration: 'none',
        color: theme.colors.text.primary,
      },
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
