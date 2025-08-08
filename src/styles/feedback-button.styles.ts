import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getFeedbackButtonStyles = (theme: GrafanaTheme2) => ({
  feedbackButton: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: theme.shadows.z1,
    // Balanced vertical spacing around the button (footer padding feel)
    margin: `${theme.spacing(1)} 0`,
    alignSelf: 'flex-start', // Left align instead of center
    
    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z2,
    },
    
    '&:active': {
      transform: 'translateY(0)',
      boxShadow: theme.shadows.z1,
    },
    
    '&:focus': {
      outline: `2px solid ${theme.colors.primary.main}`,
      outlineOffset: '2px',
    },
  }),
  feedbackIcon: css({
    fill: 'currentColor',
    flexShrink: 0,
  }),
  feedbackText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
  }),
}); 
