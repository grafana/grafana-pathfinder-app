import { GrafanaTheme2 } from '@grafana/data';
import { css, keyframes } from '@emotion/css';

export const getBadgeDetailStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;
  const successColor = '#22C55E';
  const accentColor = isDark ? '#8B7CF6' : '#6C63FF';

  const slideIn = keyframes`
    from { 
      opacity: 0; 
      transform: translate(-50%, -50%) scale(0.9);
    }
    to { 
      opacity: 1; 
      transform: translate(-50%, -50%) scale(1);
    }
  `;

  const fadeIn = keyframes`
    from { opacity: 0; }
    to { opacity: 1; }
  `;

  return {
    overlay: css({
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(4px)',
      zIndex: 1000,
      animation: `${fadeIn} 0.2s ease-out`,
    }),
    card: css({
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(320px, 90vw)',
      background: `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
      borderRadius: theme.shape.radius.lg,
      padding: theme.spacing(3),
      textAlign: 'center',
      border: `1px solid ${theme.colors.border.medium}`,
      boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4)`,
      animation: `${slideIn} 0.3s ease-out`,
    }),
    closeButton: css({
      position: 'absolute',
      top: theme.spacing(1.5),
      right: theme.spacing(1.5),
      background: 'none',
      border: 'none',
      color: theme.colors.text.secondary,
      cursor: 'pointer',
      padding: theme.spacing(0.5),
      borderRadius: theme.shape.radius.lg,
      transition: 'all 0.2s ease',
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        color: theme.colors.text.primary,
      },
    }),
    medallion: css({
      display: 'flex',
      justifyContent: 'center',
      marginBottom: theme.spacing(2),
    }),
    title: css({
      margin: 0,
      marginBottom: theme.spacing(1),
      fontSize: theme.typography.md.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
    }),
    statusBadge: css({
      display: 'inline-block',
      padding: `${theme.spacing(0.5)} ${theme.spacing(1.5)}`,
      borderRadius: theme.shape.radius.pill,
      ...theme.typography.sm,
      fontWeight: theme.typography.fontWeightMedium,
      marginBottom: theme.spacing(1.5),
    }),
    statusEarned: css({
      backgroundColor: `${successColor}20`,
      color: successColor,
    }),
    statusLocked: css({
      backgroundColor: theme.colors.background.secondary,
      color: theme.colors.text.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    statusLegacy: css({
      backgroundColor: isDark ? 'rgba(161, 136, 107, 0.2)' : 'rgba(139, 119, 101, 0.15)',
      color: isDark ? '#A1886B' : '#8B7765',
      border: `1px solid ${isDark ? 'rgba(161, 136, 107, 0.4)' : 'rgba(139, 119, 101, 0.4)'}`,
    }),
    earnedDate: css({
      margin: 0,
      marginBottom: theme.spacing(2),
      ...theme.typography.sm,
      color: theme.colors.text.secondary,
    }),
    description: css({
      margin: 0,
      marginBottom: theme.spacing(2),
      ...theme.typography.base,
      color: theme.colors.text.secondary,
      lineHeight: 1.5,
    }),
    requirementSection: css({
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(1.5),
      marginBottom: theme.spacing(2),
      textAlign: 'left',
    }),
    requirementLabel: css({
      fontSize: 10,
      fontWeight: theme.typography.fontWeightMedium,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      color: accentColor,
      marginBottom: theme.spacing(0.5),
    }),
    requirementText: css({
      ...theme.typography.sm,
      color: theme.colors.text.primary,
      lineHeight: 1.4,
    }),
    progressSection: css({
      width: '100%',
      textAlign: 'left',
    }),
    progressHeader: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing(0.75),
    }),
    progressLabel: css({
      fontSize: 10,
      fontWeight: theme.typography.fontWeightMedium,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      color: accentColor,
    }),
    progressValue: css({
      ...theme.typography.sm,
      color: theme.colors.text.secondary,
    }),
    progressPercentage: css({
      marginTop: theme.spacing(0.5),
      fontSize: theme.typography.pxToRem(16),
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      textAlign: 'center',
    }),
  };
};
