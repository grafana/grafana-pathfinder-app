/**
 * Learning Paths Styles
 *
 * Theme-aware styles for the learning paths, badges, and progress components.
 * Features gradients, animations, and engaging visual effects.
 */

import { css, keyframes } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

// ============================================================================
// COLOR PALETTE
// ============================================================================

/**
 * Gets the color palette based on theme
 */
export function getColorPalette(theme: GrafanaTheme2) {
  const isDark = theme.isDark;

  // Vibrant success green - brighter and more celebratory than theme default
  const successGreen = '#22C55E';
  const successGreenDark = '#16A34A';

  return {
    // Path accent colors
    pathAccent: isDark ? '#8B7CF6' : '#6C63FF',
    pathAccentLight: isDark ? 'rgba(139, 124, 246, 0.15)' : 'rgba(108, 99, 255, 0.12)',
    pathAccentMedium: isDark ? 'rgba(139, 124, 246, 0.3)' : 'rgba(108, 99, 255, 0.25)',
    pathGlow: isDark ? 'rgba(139, 124, 246, 0.4)' : 'rgba(108, 99, 255, 0.3)',

    // Streak fire colors
    streakFire: isDark ? '#FF8C5A' : '#FF6B35',
    streakFireLight: isDark ? 'rgba(255, 140, 90, 0.15)' : 'rgba(255, 107, 53, 0.12)',

    // Progress track
    progressTrack: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',

    // Vibrant success colors for badges and completion
    success: successGreen,
    successDark: successGreenDark,
    successLight: isDark ? 'rgba(34, 197, 94, 0.2)' : 'rgba(34, 197, 94, 0.15)',
    successGlow: isDark ? 'rgba(34, 197, 94, 0.5)' : 'rgba(34, 197, 94, 0.4)',
  };
}

// ============================================================================
// KEYFRAME ANIMATIONS
// ============================================================================

const badgeGlow = keyframes`
  0%, 100% { box-shadow: 0 0 8px rgba(255, 215, 0, 0.4); }
  50% { box-shadow: 0 0 20px rgba(255, 215, 0, 0.8); }
`;

const badgeShimmer = keyframes`
  0% { background-position: -100% 0; }
  100% { background-position: 200% 0; }
`;

const confettiFloat = keyframes`
  0% { 
    transform: translateY(0) rotate(0deg); 
    opacity: 1; 
  }
  100% { 
    transform: translateY(-100px) rotate(360deg); 
    opacity: 0; 
  }
`;

const fireBounce = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
`;

const celebrationEntry = keyframes`
  0% { 
    opacity: 0;
    transform: scale(0.8);
  }
  100% { 
    opacity: 1;
    transform: scale(1);
  }
`;

// Progress bar countdown animation - 5 seconds to match AUTO_DISMISS_DURATION
const progressCountdown = keyframes`
  0% { width: 100%; }
  100% { width: 0%; }
`;

// ============================================================================
// PROGRESS RING STYLES
// ============================================================================

export const getProgressRingStyles = (theme: GrafanaTheme2) => {
  const colors = getColorPalette(theme);

  return {
    container: css({
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    }),
    svg: css({
      transform: 'rotate(-90deg)',
    }),
    track: css({
      fill: 'none',
      stroke: colors.progressTrack,
    }),
    progress: css({
      fill: 'none',
      strokeLinecap: 'round',
      transition: 'stroke-dashoffset 0.5s ease-out',
    }),
    percentage: css({
      position: 'absolute',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      fontVariantNumeric: 'tabular-nums',
    }),
    completed: css({
      // No animation - the gradient on the stroke is enough
    }),
  };
};

// ============================================================================
// LEARNING PATH CARD STYLES
// ============================================================================

export const getLearningPathCardStyles = (theme: GrafanaTheme2) => {
  const colors = getColorPalette(theme);

  return {
    card: css({
      borderRadius: theme.shape.radius.default,
      background: `linear-gradient(135deg, ${colors.pathAccentLight} 0%, ${theme.colors.background.secondary} 100%)`,
      border: `1px solid ${colors.pathAccentMedium}`,
      transition: 'all 0.2s ease',
      overflow: 'hidden',

      '&:hover': {
        borderColor: colors.pathAccent,
        boxShadow: `0 2px 8px ${colors.pathGlow}`,
      },
    }),
    cardCompleted: css({
      background: `linear-gradient(135deg, ${colors.successLight} 0%, ${theme.colors.background.secondary} 100%)`,
      borderColor: `${colors.success}50`,

      '&:hover': {
        borderColor: colors.success,
        boxShadow: `0 2px 8px ${colors.successGlow}`,
      },
    }),
    header: css({
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(1.5),
      padding: theme.spacing(1.5),
      cursor: 'pointer',
      userSelect: 'none',
    }),
    content: css({
      flex: 1,
      minWidth: 0,
      paddingTop: theme.spacing(0.25),
    }),
    title: css({
      margin: 0,
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.3,
    }),
    titleCompleted: css({
      color: colors.success,
    }),
    meta: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      marginTop: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    metaDot: css({
      color: theme.colors.text.disabled,
    }),
    nextHint: css({
      marginTop: theme.spacing(0.75),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }),
    actions: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      flexShrink: 0,
      marginTop: theme.spacing(0.25),
    }),
    actionButton: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: colors.pathAccent,
      color: '#fff',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      whiteSpace: 'nowrap',

      '&:hover': {
        backgroundColor: theme.colors.primary.shade,
      },
    }),
    expandChevron: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      padding: 0,
      border: 'none',
      borderRadius: theme.shape.radius.default,
      background: 'transparent',
      color: theme.colors.text.secondary,
      cursor: 'pointer',
      transition: 'all 0.2s ease',

      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        color: theme.colors.text.primary,
      },
    }),
    expandChevronRotated: css({
      transform: 'rotate(180deg)',
    }),
    expandable: css({
      maxHeight: 0,
      overflow: 'hidden',
      transition: 'max-height 0.3s ease-out, opacity 0.2s ease-out',
      opacity: 0,
    }),
    expandableOpen: css({
      maxHeight: 500,
      opacity: 1,
    }),
    description: css({
      margin: 0,
      padding: `0 ${theme.spacing(1.5)} ${theme.spacing(1)}`,
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.5,
      borderTop: `1px solid ${theme.colors.border.weak}`,
      paddingTop: theme.spacing(1),
    }),
    guideList: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
      padding: `0 ${theme.spacing(1.5)} ${theme.spacing(1.5)}`,
    }),
    guideItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    guideItemCurrent: css({
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    guideIcon: css({
      width: 16,
      height: 16,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }),
    guideIconCompleted: css({
      color: colors.success,
    }),
    guideIconCurrent: css({
      color: colors.pathAccent,
    }),
    guideIconPending: css({
      color: theme.colors.text.disabled,
    }),
    guideTitle: css({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }),
  };
};

// ============================================================================
// BADGES DISPLAY STYLES
// ============================================================================

export const getBadgesDisplayStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;
  const colors = getColorPalette(theme);

  return {
    container: css({
      padding: theme.spacing(1.5),
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      marginBottom: theme.spacing(1.5),
    }),
    headerIcon: css({
      color: colors.success,
    }),
    headerTitle: css({
      margin: 0,
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),
    headerCount: css({
      marginLeft: 'auto',
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      fontVariantNumeric: 'tabular-nums',
    }),
    grid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
      gap: theme.spacing(1),
    }),
    badge: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: theme.spacing(1),
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      cursor: 'pointer',
      transition: 'all 0.2s ease',

      '&:hover': {
        transform: 'scale(1.05)',
      },
    }),
    badgeEarned: css({
      borderColor: colors.success,
      boxShadow: `0 0 8px ${colors.successGlow}`,

      '&:hover': {
        boxShadow: `0 0 16px ${colors.successGlow}`,
      },
    }),
    badgeLocked: css({
      opacity: 0.5,
      borderStyle: 'dashed',
      cursor: 'default',

      '&:hover': {
        transform: 'none',
      },
    }),
    badgeNew: css({
      animation: `${badgeGlow} 1.5s ease-in-out infinite, ${badgeShimmer} 2s linear infinite`,
      background: `linear-gradient(90deg, ${colors.successLight}, transparent, ${colors.successLight})`,
      backgroundSize: '200% 100%',
    }),
    badgeLegacy: css({
      // Muted/sepia style for badges earned in previous versions
      borderColor: isDark ? 'rgba(161, 136, 107, 0.5)' : 'rgba(139, 119, 101, 0.5)',
      backgroundColor: isDark ? 'rgba(161, 136, 107, 0.1)' : 'rgba(139, 119, 101, 0.1)',
      filter: 'sepia(30%)',

      '&:hover': {
        borderColor: isDark ? 'rgba(161, 136, 107, 0.7)' : 'rgba(139, 119, 101, 0.7)',
        boxShadow: `0 0 8px ${isDark ? 'rgba(161, 136, 107, 0.3)' : 'rgba(139, 119, 101, 0.3)'}`,
      },
    }),
    badgeIconLegacy: css({
      color: isDark ? '#A1886B' : '#8B7765',
    }),
    badgeIcon: css({
      fontSize: 24,
      lineHeight: 1,
    }),
    badgeIconEarned: css({
      color: colors.success,
    }),
    badgeIconLocked: css({
      color: theme.colors.text.disabled,
      filter: 'grayscale(100%)',
    }),
    badgeTitle: css({
      fontSize: 10,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.secondary,
      textAlign: 'center',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '100%',
    }),
    badgeTitleEarned: css({
      color: theme.colors.text.primary,
    }),
  };
};

// ============================================================================
// BADGE UNLOCKED TOAST STYLES
// ============================================================================

export const getBadgeUnlockedToastStyles = (theme: GrafanaTheme2) => {
  const colors = getColorPalette(theme);

  // Use vibrant success colors for celebration
  const celebrationGreen = colors.success;
  const celebrationGreenDark = colors.successDark;
  const celebrationGreenLight = colors.successLight;
  const celebrationGreenGlow = colors.successGlow;

  return {
    overlay: css({
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      backdropFilter: 'blur(4px)',
      zIndex: theme.zIndex.modal,
      animation: `${celebrationEntry} 0.3s ease-out`,
    }),
    toast: css({
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: theme.spacing(3),
      borderRadius: 16,
      backgroundColor: theme.colors.background.primary,
      border: `2px solid ${celebrationGreen}`,
      boxShadow: `0 8px 32px rgba(0, 0, 0, 0.3), 0 0 24px ${celebrationGreenGlow}`,
      minWidth: 280,
      maxWidth: 320,
      animation: `${celebrationEntry} 0.4s ease-out`,
      overflow: 'hidden',
    }),
    confettiContainer: css({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
    }),
    confetti: css({
      position: 'absolute',
      top: '100%',
      width: 8,
      height: 8,
      borderRadius: 2,
      willChange: 'transform',
      animation: `${confettiFloat} 1.5s ease-out forwards`,
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      marginBottom: theme.spacing(1),
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: celebrationGreen,
    }),
    badgeContainer: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 96,
      height: 96,
      borderRadius: '50%',
      backgroundColor: celebrationGreenLight,
      border: `3px solid ${celebrationGreen}`,
      marginBottom: theme.spacing(2),
      boxShadow: `0 0 16px ${celebrationGreenGlow}`,
    }),
    badgeIcon: css({
      color: celebrationGreen,
      filter: `drop-shadow(0 0 8px ${celebrationGreen})`,
    }),
    badgeTitle: css({
      margin: 0,
      marginBottom: theme.spacing(0.5),
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      textAlign: 'center',
    }),
    badgeDescription: css({
      margin: 0,
      marginBottom: theme.spacing(2),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      textAlign: 'center',
    }),
    dismissButton: css({
      padding: `${theme.spacing(1)} ${theme.spacing(3)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: celebrationGreen,
      color: '#fff',
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.2s ease',

      '&:hover': {
        backgroundColor: celebrationGreenDark,
        transform: 'scale(1.05)',
      },
    }),
    progressBar: css({
      width: '100%',
      height: 3,
      backgroundColor: celebrationGreenLight,
      borderRadius: 2,
      overflow: 'hidden',
      marginBottom: theme.spacing(2),
    }),
    progressFill: css({
      height: '100%',
      width: '100%',
      backgroundColor: celebrationGreen,
      borderRadius: 2,
      boxShadow: `0 0 6px ${celebrationGreenGlow}`,
      animation: `${progressCountdown} 5s linear forwards`,
    }),
  };
};

// ============================================================================
// STREAK INDICATOR STYLES
// ============================================================================

export const getStreakIndicatorStyles = (theme: GrafanaTheme2) => {
  const colors = getColorPalette(theme);

  return {
    container: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.pill,
      backgroundColor: colors.streakFireLight,
      border: `1px solid ${colors.streakFire}`,
    }),
    fireIcon: css({
      color: colors.streakFire,
      animation: `${fireBounce} 1.5s ease-in-out infinite`,
    }),
    fireIconInactive: css({
      color: theme.colors.text.disabled,
      animation: 'none',
    }),
    text: css({
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      fontVariantNumeric: 'tabular-nums',
    }),
    textAtRisk: css({
      color: colors.streakFire,
    }),
  };
};

// ============================================================================
// LEARNING PATHS PANEL STYLES
// ============================================================================

export const getLearningPathsPanelStyles = (theme: GrafanaTheme2) => {
  const colors = getColorPalette(theme);

  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
      marginBottom: theme.spacing(2),
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: theme.spacing(1),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    }),
    headerLeft: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    headerIcon: css({
      color: colors.pathAccent,
    }),
    headerTitle: css({
      margin: 0,
      fontSize: theme.typography.h6.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),
    pathsGrid: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
    }),
    viewBadgesLink: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: 'transparent',
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.2s ease',

      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        color: theme.colors.text.primary,
      },
    }),
  };
};
