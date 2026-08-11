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
// Height cap for the My paths / Badges columns, and for the Discover more list.
const COLUMN_MAX_HEIGHT = 440;
const DISCOVER_LIST_MAX_HEIGHT = 352;

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

    // Query context for the two-column row. Deliberately scoped to this wrapper
    // rather than the page container: `container-type` implies layout
    // containment, which would make the container a containing block for
    // `position: fixed` descendants and trap the BadgeDetailCard overlay inside
    // the panel instead of covering the viewport.
    columnsContainer: css({
      containerType: 'inline-size',
    }),

    // 7:5 of the design's 12-column grid. The query resolves against the
    // wrapper's own width, not the viewport, so the row stacks in the docked
    // sidebar and splits when floating.
    columnsRow: css({
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: theme.spacing(2),
      alignItems: 'stretch',
      '@container (min-width: 640px)': {
        gridTemplateColumns: '7fr 5fr',
      },
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
    statValueBadges: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: accentColor,
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
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2),
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    // Caps the two side-by-side columns so a long list scrolls in place instead
    // of stretching the row. Both columns hit the same cap, so their bottom
    // edges — and their fades — line up. Only while side by side: stacked in the
    // docked sidebar, capping would nest a scroller inside the scrolling page
    // for no alignment benefit.
    columnSection: css({
      '@container (min-width: 640px)': {
        maxHeight: COLUMN_MAX_HEIGHT,
      },
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

    // Badges Grid - centered-icon tiles.
    // `min-content` rows are load-bearing: as a flex child the grid gets a
    // definite height, and default auto rows would then compress below their
    // intrinsic size and clamp two-line badge names to one line.
    badgesGrid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
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
      maxHeight: DISCOVER_LIST_MAX_HEIGHT,
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
