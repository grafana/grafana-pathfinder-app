/**
 * Styles for MyLearningTab component
 *
 * Separated from the main component to reduce file size and improve maintainability.
 */

import { GrafanaTheme2 } from '@grafana/data';
import { css, keyframes } from '@emotion/css';

const SCROLL_FADE_HEIGHT = 40;
// Deliberately shorter than the fade band: the padding keeps the last item
// legible once fully scrolled, while the uncovered remainder lets the next item
// peek through the gradient so "there is more below" stays visible.
const SCROLL_FADE_PADDING = 12;
// Height cap for the Discover more list.

export const getMyLearningStyles = (theme: GrafanaTheme2, hideSectionIcons = false) => {
  const isDark = theme.isDark;
  const accentColor = isDark ? '#8B7CF6' : '#6C63FF';

  // Vibrant success green for earned badges
  const successGreen = '#22C55E';
  const successGreenGlow = isDark ? 'rgba(34, 197, 94, 0.5)' : 'rgba(34, 197, 94, 0.4)';

  const iconCallout = (size: number, tint?: string) =>
    css({
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: theme.spacing(size),
      height: theme.spacing(size),
      flexShrink: 0,
      color: tint ?? theme.colors.text.primary,
      border: tint ? '1px solid transparent' : `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.md,
      boxSizing: 'border-box',
      isolation: 'isolate',
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: theme.spacing(0.25),
        backgroundColor: theme.colors.background.secondary,
        backgroundImage: tint
          ? `linear-gradient(oklch(from ${tint} l c h / 12%), oklch(from ${tint} l c h / 12%))`
          : undefined,
        borderRadius: `calc(${theme.shape.radius.md} - 1px - ${theme.spacing(0.25)})`,
        zIndex: -1,
        pointerEvents: 'none',
      },
    });

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
      gap: theme.spacing(hideSectionIcons ? 6 : 4),
      height: '100%',
      overflowY: 'auto',
    }),

    columnsContainer: css({}),
    columnsRow: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(hideSectionIcons ? 6 : 4),
    }),

    // Fills the leftover height of its section so the region's bottom edge is
    // the panel's bottom edge — that keeps the fade pinned to the panel rather
    // than floating above it when a stretched sibling column is taller.
    // `flexShrink: 0` on the children is load-bearing: without it a bounded
    // height squashes every card to fit instead of scrolling.
    // The bottom padding lives here rather than alongside the mask so that
    // toggling the fade cannot change scrollHeight: padding counts toward
    // scrollHeight, so a fade that added its own padding would keep its own
    // overflow condition true and latch on.
    scrollRegion: css({
      overflowY: 'auto',
      flex: 1,
      minHeight: 0,
      paddingBottom: SCROLL_FADE_PADDING,
      scrollbarWidth: 'thin',
      '& > *': {
        flexShrink: 0,
      },
    }),
    // Applied only while the region actually overflows. Unconditionally masking
    // would dim the last item of a list that already fits.
    scrollRegionFaded: css({
      maskImage: `linear-gradient(to bottom, #000 calc(100% - ${SCROLL_FADE_HEIGHT}px), transparent 100%)`,
    }),

    heroSection: css({
      containerType: 'inline-size',
      paddingBottom: theme.spacing(1),
      flexShrink: 0,
    }),
    previewNotice: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(0.75),
      marginTop: theme.spacing(1.5),
      padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
      borderRadius: theme.shape.radius.md,
      backgroundColor: isDark ? 'rgba(140, 140, 140, 0.1)' : 'rgba(0, 0, 0, 0.04)',
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      '& svg': {
        color: theme.colors.text.disabled,
        flexShrink: 0,
      },
    }),
    statsRow: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: theme.spacing(2),
      '@container (min-width: 960px)': {
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      },
      '@container (max-width: 399px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    statItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(2),
      padding: theme.spacing(1.5),
      minWidth: 0,
      backgroundColor: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.md,
    }),
    statIcon: iconCallout(5),
    statIconCompleted: iconCallout(5, theme.colors.success.text),
    statIconBadges: iconCallout(5, theme.colors.info.text),
    statIconStreak: iconCallout(5, theme.colors.warning.text),
    statIconAltitude: iconCallout(5, theme.visualization.getColorByName('purple')),
    statContent: css({
      minWidth: 0,
    }),
    statValue: css({
      ...theme.typography.lg,
      color: theme.colors.text.primary,
      fontVariantNumeric: 'tabular-nums',
    }),
    statValueBadges: css({
      ...theme.typography.lg,
      color: theme.colors.text.primary,
      fontVariantNumeric: 'tabular-nums',
    }),
    statValueStreak: css({
      ...theme.typography.lg,
      color: theme.colors.text.primary,
      fontVariantNumeric: 'tabular-nums',
    }),
    statValueAltitude: css({
      ...theme.typography.md,
      color: theme.colors.text.primary,
      overflowWrap: 'anywhere',
    }),
    statLabel: css({
      ...theme.typography.sm,
      color: theme.colors.text.secondary,
    }),

    // Sections
    section: css({
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      paddingTop: theme.spacing(1),
    }),
    columnSection: css({}),
    openSection: css({
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      paddingTop: theme.spacing(1),
    }),
    sectionHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      marginBottom: theme.spacing(2),
      minHeight: theme.spacing(4.5),
    }),
    sectionIcon: hideSectionIcons ? css({ display: 'none' }) : iconCallout(5),
    sectionHeadingText: css({ flex: 1, minWidth: 0 }),
    sectionTitle: css({
      margin: 0,
      ...(hideSectionIcons ? theme.typography.h3 : theme.typography.md),
      color: theme.colors.text.primary,
      flex: 1,
    }),
    sectionDescription: css({
      margin: 0,
      marginTop: theme.spacing(0.5),
      ...(hideSectionIcons ? theme.typography.base : theme.typography.sm),
      color: theme.colors.text.secondary,
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
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
      alignItems: 'stretch',
      gap: theme.spacing(2),
    }),

    // Badges Grid - centered-icon tiles.
    // `min-content` rows are load-bearing: as a flex child the grid gets a
    // definite height, and default auto rows would then compress below their
    // intrinsic size and clamp two-line badge names to one line.
    badgesGrid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gridAutoRows: 'min-content',
      gap: theme.spacing(1),
    }),
    badgeTile: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: theme.spacing(0.75),
      padding: theme.spacing(1),
      minHeight: 104,
      borderRadius: theme.shape.radius.md,
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
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
      alignItems: 'start',
      gap: theme.spacing(2),
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
      borderRadius: theme.shape.radius.md,
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
      borderRadius: theme.shape.radius.md,
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
