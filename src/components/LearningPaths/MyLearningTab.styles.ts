/**
 * Styles for MyLearningTab component
 *
 * Separated from the main component to reduce file size and improve maintainability.
 */

import { GrafanaTheme2 } from '@grafana/data';
import { css, keyframes } from '@emotion/css';

export const getMyLearningStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;
  const accentColor = isDark ? '#8B7CF6' : '#6C63FF';
  const accentLight = isDark ? 'rgba(139, 124, 246, 0.15)' : 'rgba(108, 99, 255, 0.12)';

  // Vibrant success green for earned badges
  const successGreen = '#22C55E';
  const successGreenGlow = isDark ? 'rgba(34, 197, 94, 0.5)' : 'rgba(34, 197, 94, 0.4)';

  const badgeFadeIn = keyframes`
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  `;

  const successGlow = keyframes`
    0%, 100% { box-shadow: 0 0 8px ${successGreenGlow}; }
    50% { box-shadow: 0 0 16px ${successGreenGlow}; }
  `;

  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
      padding: theme.spacing(1), // Match recommendations tab horizontal padding
      height: '100%',
      overflowY: 'auto',
    }),

    // auto-fit + minmax sizes off the row's own width, not the viewport, so the row stacks in the docked sidebar and splits when floating.
    columnsRow: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
      gap: theme.spacing(2),
      alignItems: 'stretch',
    }),

    // Hero Section
    heroSection: css({
      background: `linear-gradient(135deg, ${accentLight} 0%, ${theme.colors.background.primary} 100%)`,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2.5),
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    heroContent: css({
      textAlign: 'center',
      marginBottom: theme.spacing(2),
    }),
    previewNotice: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(0.75),
      marginTop: theme.spacing(1.5),
      padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: isDark ? 'rgba(140, 140, 140, 0.1)' : 'rgba(0, 0, 0, 0.04)',
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      '& svg': {
        color: theme.colors.text.disabled,
        flexShrink: 0,
      },
    }),
    heroTitle: css({
      margin: 0,
      fontSize: theme.typography.h4.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      background: `linear-gradient(90deg, ${accentColor}, ${theme.colors.primary.main})`,
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    }),
    heroSubtitle: css({
      margin: 0,
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.secondary,
    }),

    // Stats Row - compact to fit on single line at narrow widths
    statsRow: css({
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      flexWrap: 'wrap',
    }),
    statItem: css({
      textAlign: 'center',
      minWidth: 70,
    }),
    statValue: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      fontVariantNumeric: 'tabular-nums',
    }),
    statValueStreak: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: isDark ? '#FF8C5A' : '#FF6B35',
      fontVariantNumeric: 'tabular-nums',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(0.5),
    }),
    // The static "learning altitude" value — a gradient accent word, matching
    // the hero title treatment so it reads as a status rather than a metric.
    statValueAltitude: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      background: `linear-gradient(90deg, ${accentColor}, ${theme.colors.primary.main})`,
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    }),
    fireEmoji: css({
      fontSize: '1.1em',
    }),
    statLabel: css({
      fontSize: '11px',
      color: theme.colors.text.secondary,
    }),
    statDivider: css({
      width: 1,
      height: 28,
      backgroundColor: theme.colors.border.weak,
    }),

    // Sections
    section: css({
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2),
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    sectionHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      marginBottom: theme.spacing(0.5),
    }),
    sectionIcon: css({
      color: accentColor,
    }),
    sectionTitle: css({
      margin: 0,
      fontSize: theme.typography.h6.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      flex: 1,
    }),
    sectionDescription: css({
      margin: 0,
      marginBottom: theme.spacing(1.5),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    expandButton: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: 'transparent',
      color: theme.colors.text.link,
      fontSize: theme.typography.bodySmall.fontSize,
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
      },
    }),

    // Empty-state message shared by sections with no items yet
    emptyMessage: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing(3),
      textAlign: 'center',
      color: theme.colors.text.secondary,
      gap: theme.spacing(1),
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    emptyIcon: css({
      color: theme.colors.text.disabled,
    }),

    // Paths Grid
    pathsGrid: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
    }),

    // Badges Grid - centered-icon tiles
    badgesGrid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
      gap: theme.spacing(1),
      maxHeight: '260px',
      overflow: 'hidden',
      transition: 'max-height 0.3s ease-out',
    }),
    badgesGridExpanded: css({
      maxHeight: '1200px',
      overflow: 'visible',
    }),
    badgeTile: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: theme.spacing(0.75),
      padding: theme.spacing(1),
      minHeight: 104,
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      animation: `${badgeFadeIn} 0.3s ease-out forwards`,
      opacity: 0,
      textAlign: 'center',
      '&:hover': {
        transform: 'translateY(-2px)',
        boxShadow: `0 4px 12px rgba(0, 0, 0, 0.15)`,
        borderColor: accentColor,
      },
    }),
    badgeTileEarned: css({
      borderColor: successGreen,
      backgroundColor: isDark ? 'rgba(34, 197, 94, 0.08)' : 'rgba(34, 197, 94, 0.06)',
      animation: `${badgeFadeIn} 0.3s ease-out forwards, ${successGlow} 3s ease-in-out infinite`,
    }),
    badgeTileLocked: css({
      borderStyle: 'dashed',
      backgroundColor: isDark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.03)',
      '& svg': {
        color: theme.colors.text.disabled,
        filter: 'grayscale(100%)',
        opacity: 0.5,
      },
    }),
    badgeTileLegacy: css({
      borderColor: isDark ? 'rgba(161, 136, 107, 0.5)' : 'rgba(139, 119, 101, 0.5)',
      backgroundColor: isDark ? 'rgba(161, 136, 107, 0.15)' : 'rgba(139, 119, 101, 0.1)',
      filter: 'sepia(20%)',
      '& svg': {
        color: isDark ? '#A1886B' : '#8B7765',
      },
    }),
    badgeTileIconWrapper: css({
      position: 'relative',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: 40,
    }),
    badgeEmoji: css({
      fontSize: 40,
      lineHeight: 1,
    }),
    badgeTileEmoji: css({
      fontSize: 34,
      lineHeight: 1,
    }),
    badgeCheckmark: css({
      position: 'absolute',
      bottom: -4,
      right: -4,
      width: 16,
      height: 16,
      borderRadius: '50%',
      backgroundColor: successGreen,
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: `2px solid ${theme.colors.background.primary}`,
      '& svg': {
        color: 'white !important',
        filter: 'none !important',
        opacity: '1 !important',
      },
    }),
    badgeLegacyIndicator: css({
      position: 'absolute',
      bottom: -4,
      right: -4,
      width: 16,
      height: 16,
      borderRadius: '50%',
      backgroundColor: isDark ? '#A1886B' : '#8B7765',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: `2px solid ${theme.colors.background.primary}`,
      '& svg': {
        color: 'white !important',
        filter: 'none !important',
        opacity: '1 !important',
      },
    }),
    badgeTileLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.2,
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
    }),
    badgeTileLabelLocked: css({
      color: theme.colors.text.secondary,
    }),
    badgeTileLabelLegacy: css({
      color: isDark ? '#A1886B' : '#8B7765',
      fontStyle: 'italic',
    }),
    badgeTileProgress: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: theme.spacing(0.25),
      width: '100%',
      marginTop: 'auto',
    }),
    badgeTileProgressTrack: css({
      width: '100%',
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.border.weak,
      overflow: 'hidden',
    }),
    badgeTileProgressBar: css({
      height: '100%',
      borderRadius: 2,
      background: `linear-gradient(90deg, ${accentColor}, ${theme.colors.primary.main})`,
      transition: 'width 0.3s ease',
      minWidth: 0,
    }),
    badgeTileProgressText: css({
      fontSize: 9,
      color: theme.colors.text.secondary,
      fontVariantNumeric: 'tabular-nums',
    }),

    // Discover More list
    discoverList: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
    }),
    discoverCard: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      padding: theme.spacing(1.5),
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      transition: 'all 0.2s ease',
      '&:hover': {
        borderColor: accentColor,
      },
    }),
    discoverIcon: css({
      flexShrink: 0,
      width: 36,
      height: 36,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: accentLight,
      color: accentColor,
    }),
    discoverBody: css({
      flex: 1,
      minWidth: 0,
    }),
    discoverTitle: css({
      margin: 0,
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    discoverMeta: css({
      margin: 0,
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    discoverStartButton: css({
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(0.5)} ${theme.spacing(1.5)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.primary.main,
      color: theme.colors.primary.contrastText,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      '&:hover:not(:disabled)': {
        backgroundColor: theme.colors.primary.shade,
      },
      '&:disabled': {
        opacity: 0.6,
        cursor: 'not-allowed',
      },
    }),

    // Completed list
    completedList: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    completedItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      padding: theme.spacing(1.5),
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    completedIcon: css({
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      borderRadius: '50%',
      border: `2px solid ${successGreen}`,
      color: successGreen,
    }),
    completedTitle: css({
      flex: 1,
      minWidth: 0,
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.primary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    completedDoneBadge: css({
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.pill,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: successGreen,
      border: `1px solid ${successGreen}`,
      backgroundColor: isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.08)',
    }),

    // Footer
    footer: css({
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing(2),
      paddingTop: theme.spacing(1),
      borderTop: `1px solid ${theme.colors.border.weak}`,
    }),
    resetButton: css({
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: 'transparent',
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      border: `1px solid ${theme.colors.border.weak}`,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      '&:hover': {
        backgroundColor: theme.colors.error.transparent,
        borderColor: theme.colors.error.border,
        color: theme.colors.error.text,
      },
    }),
  };
};
