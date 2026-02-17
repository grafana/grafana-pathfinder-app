/**
 * Styles for BadgeDetailCard component
 *
 * Separated from the main component to reduce file size and improve maintainability.
 */

import { GrafanaTheme2 } from '@grafana/data';
import { css, keyframes } from '@emotion/css';

export const getBadgeDetailStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;
  // Vibrant success green for earned badges
  const successColor = '#22C55E';
  const successGlow = isDark ? 'rgba(34, 197, 94, 0.5)' : 'rgba(34, 197, 94, 0.4)';
  const accentColor = isDark ? '#8B7CF6' : '#6C63FF';

  const shimmer = keyframes`
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  `;

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
      borderRadius: 16,
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
      borderRadius: '50%',
      transition: 'all 0.2s ease',
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        color: theme.colors.text.primary,
      },
    }),
    iconWrapper: css({
      position: 'relative',
      width: 80,
      height: 80,
      margin: '0 auto',
      marginBottom: theme.spacing(2),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '50%',
    }),
    iconEarned: css({
      background: `linear-gradient(135deg, ${successColor}40 0%, ${successColor}15 100%)`,
      // Vibrant glow effect
      boxShadow: `0 0 24px ${successGlow}, 0 0 48px ${successGlow}`,
      border: `2px solid ${successColor}`,
      '& svg': {
        color: successColor,
        filter: `drop-shadow(0 0 10px ${successColor})`,
      },
    }),
    iconLocked: css({
      background: theme.colors.background.secondary,
      border: `2px dashed ${theme.colors.border.weak}`,
      '& svg': {
        color: theme.colors.text.disabled,
      },
    }),
    iconLegacy: css({
      background: isDark ? 'rgba(161, 136, 107, 0.2)' : 'rgba(139, 119, 101, 0.15)',
      border: `2px solid ${isDark ? 'rgba(161, 136, 107, 0.6)' : 'rgba(139, 119, 101, 0.5)'}`,
      filter: 'sepia(20%)',
      '& svg': {
        color: isDark ? '#A1886B' : '#8B7765',
      },
    }),
    badgeEmoji: css({
      fontSize: 40,
      lineHeight: 1,
    }),
    iconGlow: css({
      position: 'absolute',
      inset: -6,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${successGlow} 0%, transparent 60%)`,
    }),
    checkmark: css({
      position: 'absolute',
      bottom: -2,
      right: -2,
      width: 24,
      height: 24,
      borderRadius: '50%',
      backgroundColor: successColor,
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: `2px solid ${theme.colors.background.primary}`,
      boxShadow: `0 0 8px ${successGlow}`,
    }),
    legacyIndicator: css({
      position: 'absolute',
      bottom: -2,
      right: -2,
      width: 24,
      height: 24,
      borderRadius: '50%',
      backgroundColor: isDark ? '#A1886B' : '#8B7765',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: `2px solid ${theme.colors.background.primary}`,
    }),
    title: css({
      margin: 0,
      marginBottom: theme.spacing(1),
      fontSize: theme.typography.h4.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
    }),
    statusBadge: css({
      display: 'inline-block',
      padding: `${theme.spacing(0.5)} ${theme.spacing(1.5)}`,
      borderRadius: 20,
      fontSize: theme.typography.bodySmall.fontSize,
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
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    description: css({
      margin: 0,
      marginBottom: theme.spacing(2),
      fontSize: theme.typography.body.fontSize,
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
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.primary,
      lineHeight: 1.4,
    }),
    progressSection: css({
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
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    progressBarOuter: css({
      position: 'relative',
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.background.secondary,
      overflow: 'hidden',
    }),
    progressBarInner: css({
      position: 'absolute',
      top: 0,
      left: 0,
      height: '100%',
      borderRadius: 4,
      background: `linear-gradient(90deg, ${accentColor}, ${theme.colors.primary.main})`,
      transition: 'width 0.5s ease-out',
    }),
    progressBarShimmer: css({
      position: 'absolute',
      top: 0,
      left: 0,
      height: '100%',
      background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)`,
      animation: `${shimmer} 2s infinite`,
    }),
    progressPercentage: css({
      marginTop: theme.spacing(0.5),
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      textAlign: 'center',
    }),
  };
};
