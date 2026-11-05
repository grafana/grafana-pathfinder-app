/**
 * Styles for MyLearningTab component
 *
 * Separated from the main component to reduce file size and improve maintainability.
 */

import { GrafanaTheme2 } from '@grafana/data';
import { css, keyframes } from '@emotion/css';
import { getLearningCardInteractionStyles } from '../LearningContentCard/learning-card-interaction.styles';

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

  const iconCallout = (size: number, tint?: string, bright = false) =>
    css({
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: theme.spacing(size),
      height: theme.spacing(size),
      flexShrink: 0,
      color: tint ?? theme.colors.text.primary,
      border: tint
        ? '1px solid transparent'
        : `1px solid ${bright ? theme.colors.border.medium : theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.md,
      boxSizing: 'border-box',
      isolation: 'isolate',
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: theme.spacing(0.25),
        backgroundColor: bright ? theme.colors.background.elevated : theme.colors.background.secondary,
        backgroundImage: bright
          ? `linear-gradient(${theme.colors.action.hover}, ${theme.colors.action.hover})`
          : tint
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

  return {
    homeAssignmentsList: css({
      maxHeight: theme.spacing(31),
      overflow: 'auto',
      overscrollBehavior: 'contain',
      scrollbarGutter: 'stable',
      scrollbarWidth: 'thin',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.lg,
      containerType: 'inline-size',
      '& > div': { overflow: 'visible' },
      '& > p': { ...theme.typography.base, color: theme.colors.text.secondary, margin: theme.spacing(2) },
      '&:focus-visible': { outline: `2px solid ${theme.colors.primary.main}`, outlineOffset: 2 },
    }),
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(hideSectionIcons ? 6 : 4),
      height: '100%',
      overflowY: hideSectionIcons ? 'visible' : 'auto',
      ...(hideSectionIcons && {
        containerType: 'inline-size',
        '& [data-learning-card] [data-learning-topic-icon]': {
          width: theme.spacing(5),
          height: theme.spacing(5),
          '& svg': { width: 22, height: 22 },
        },
      }),
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

    learningSummary: css({
      ...theme.typography.base,
      fontSize: 18,
      fontWeight: theme.typography.fontWeightMedium,
      lineHeight: 1.6,
      color: theme.colors.text.secondary,
      maxWidth: 880,
      margin: 0,
      '& strong': {
        color: theme.colors.text.primary,
        fontWeight: theme.typography.fontWeightMedium,
        whiteSpace: 'nowrap',
      },
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
    statIconStreak: iconCallout(5, theme.visualization.getColorByName('red')),
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
    intro: hideSectionIcons
      ? css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(4) })
      : css({ display: 'contents' }),
    achievements: css({
      '&&': { paddingTop: 0 },
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    achievementsAction: css({ alignSelf: 'flex-start' }),
    homeBadgeShelf: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: theme.spacing(2),
      minWidth: 0,
      '& h2': {
        ...theme.typography.md,
        fontSize: theme.typography.size.lg,
        color: theme.colors.text.primary,
        margin: 0,
      },
      '& p': { ...theme.typography.sm, color: theme.colors.text.secondary, margin: 0 },
    }),
    homeBadgeHeader: css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing(1) }),
    homeBadgeGroup: css({
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'stretch',
      gap: 0,
    }),
    badgeSummaryItem: css({
      '&&': {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing(1),
        width: theme.spacing(8),
        minHeight: theme.spacing(8),
        padding: theme.spacing(1),
        textAlign: 'center',
        background: 'none',
        border: '1px solid transparent',
        borderRadius: theme.shape.radius.lg,
        boxShadow: 'none',
        animation: 'none',
        opacity: 1,
        ...getLearningCardInteractionStyles(theme),
        '&:hover:not([data-selected="true"])': { borderColor: 'transparent' },
      },
    }),
    homeBadgeTarget: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      maxWidth: '100%',
      minWidth: 0,
      minHeight: theme.spacing(8),
      padding: theme.spacing(1),
      background: 'none',
      border: '1px solid transparent',
      borderRadius: theme.shape.radius.lg,
      color: theme.colors.text.primary,
      textAlign: 'left',
      cursor: 'pointer',
      ...getLearningCardInteractionStyles(theme),
      '&:hover:not([data-selected="true"])': { borderColor: 'transparent' },
    }),
    homeBadgeTargetBody: css({
      ...theme.typography.base,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.25),
      minWidth: 0,
      maxWidth: theme.spacing(44),
    }),
    homeBadgeTargetDescription: css({
      ...theme.typography.sm,
      color: theme.colors.text.secondary,
    }),
    homeBadgeTargetName: css({ fontWeight: theme.typography.fontWeightMedium }),
    homeBadgeTargetTrack: css({
      width: theme.spacing(28),
      maxWidth: '100%',
      height: theme.spacing(0.5),
      borderRadius: theme.shape.radius.pill,
    }),
    achievementsRow: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: theme.spacing(2),
    }),
    achievementsGrid: css({
      '& > button': {
        background: 'none',
        borderColor: 'transparent',
        boxShadow: 'none',
        animation: 'none',
        opacity: 1,
        minHeight: theme.spacing(10),
        width: 80,
      },
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, 80px)',
      flex: '1 1 280px',
      columnGap: 0,
      rowGap: theme.spacing(1),
    }),
    badgeGallery: css({
      '&&': {
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gridAutoRows: '1fr',
        gap: theme.spacing(1.5),
        '& > button': {
          width: '100%',
          minHeight: theme.spacing(24),
          padding: theme.spacing(2),
          gap: theme.spacing(2),
          background: theme.colors.background.primary,
          border: `1px solid ${theme.colors.border.weak}`,
          borderRadius: theme.shape.radius.lg,
          boxShadow: 'none',
          '& > div': { gap: theme.spacing(1) },
          '& > div:has(time)': { gap: theme.spacing(0.25) },
          ...getLearningCardInteractionStyles(theme),
        },
      },
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
    sectionIcon: iconCallout(5, undefined, hideSectionIcons),
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
    homeContinueLayout: css({
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 2.8fr)',
      gap: theme.spacing(1.5),
      alignItems: 'stretch',
      '&[data-single-card]': { gridTemplateColumns: 'minmax(0, 480px)' },
      '@container learning-continue (max-width: 1200px)': { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)' },
      '@container learning-continue (max-width: 960px)': {
        gridTemplateColumns: 'minmax(0, 1fr)',
        '&[data-single-card]': { gridTemplateColumns: 'minmax(0, 1fr)' },
      },
    }),
    homeContinuePrimary: css({ minWidth: 0, display: 'flex', '& > div, & > article': { width: '100%' } }),
    homeContinueSecondary: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gridAutoRows: 'minmax(0, 1fr)',
      alignSelf: 'start',
      gap: theme.spacing(1.5),
      minWidth: 0,
      '@container learning-continue (max-width: 1200px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
      '@container learning-continue (max-width: 960px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
      '@container learning-continue (max-width: 760px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
      '@container learning-continue (max-width: 440px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
    }),
    homeContinueOverflow: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
      gap: theme.spacing(1.5),
    }),
    homeContinueStack: css({
      containerType: 'inline-size',
      containerName: 'learning-continue',
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
    }),
    pathsGrid: css({
      display: 'grid',
      gridTemplateColumns: hideSectionIcons
        ? 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))'
        : 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
      alignItems: 'stretch',
      gap: theme.spacing(1.5),
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
      animation: `${badgeFadeIn} 0.3s ease-out forwards`,
      opacity: 0,
      textAlign: 'center',
      ...getLearningCardInteractionStyles(theme),
    }),
    badgeTileBody: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
      width: '100%',
      minWidth: 0,
    }),
    badgeTileLabel: css({
      ...theme.typography.base,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),
    badgeTileEarnedDate: css({
      ...theme.typography.sm,
      color: theme.colors.text.secondary,
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
    discoverList: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
      alignItems: 'start',
      gap: theme.spacing(1.5),
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
