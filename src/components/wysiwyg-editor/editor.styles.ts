import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

/**
 * Color scheme for interactive element types
 * Each type has distinct colors for easy visual differentiation
 */
const getColorScheme = (theme: GrafanaTheme2) => ({
  // Section - Blue
  section: {
    background: theme.isDark ? 'rgba(74, 144, 226, 0.12)' : 'rgba(74, 144, 226, 0.08)',
    border: theme.colors.primary.border,
    badge: theme.colors.primary.main,
    badgeText: theme.colors.primary.contrastText,
  },
  // Multistep - Purple
  multistep: {
    background: theme.isDark ? 'rgba(138, 43, 226, 0.12)' : 'rgba(138, 43, 226, 0.08)',
    border: theme.isDark ? '#9370DB' : '#8B5CF6',
    badge: theme.isDark ? '#9370DB' : '#8B5CF6',
    badgeText: '#FFFFFF',
  },
  // Guided - Teal
  guided: {
    background: theme.isDark ? 'rgba(20, 184, 166, 0.12)' : 'rgba(20, 184, 166, 0.08)',
    border: theme.isDark ? '#2DD4BF' : '#14B8A6',
    badge: theme.isDark ? '#2DD4BF' : '#14B8A6',
    badgeText: '#FFFFFF',
  },
  // Interactive step - Amber
  interactive: {
    background: theme.isDark ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.08)',
    border: theme.isDark ? '#FBBF24' : '#F59E0B',
    badge: theme.isDark ? '#FBBF24' : '#F59E0B',
    badgeText: '#1F2937',
  },
  // Note/Comment - Orange
  note: {
    background: theme.isDark ? 'rgba(249, 115, 22, 0.15)' : 'rgba(249, 115, 22, 0.12)',
    border: theme.isDark ? '#FB923C' : '#F97316',
    badge: theme.isDark ? '#FB923C' : '#F97316',
    badgeText: '#FFFFFF',
  },
});

/**
 * Theme-aware styles for the WYSIWYG editor
 * Replaces hardcoded CSS with Grafana's theming system
 */
export const getEditorStyles = (theme: GrafanaTheme2) => {
  const colors = getColorScheme(theme);

  return {
    // Main ProseMirror editor area
    proseMirror: css({
      minHeight: '400px',
      padding: theme.spacing(2),
      outline: 'none',
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      color: theme.colors.text.primary,
      fontSize: theme.typography.body.fontSize,
      lineHeight: 1.6,

      '&:focus': {
        borderColor: theme.colors.border.strong,
      },

      // Headings
      '& h1': {
        fontSize: theme.typography.h2.fontSize,
        fontWeight: theme.typography.fontWeightMedium,
        color: theme.colors.text.primary,
        margin: `${theme.spacing(0.67)} 0`,
      },

      '& h2': {
        fontSize: theme.typography.h3.fontSize,
        fontWeight: theme.typography.fontWeightMedium,
        color: theme.colors.text.primary,
        margin: `${theme.spacing(0.75)} 0`,
      },

      '& h3': {
        fontSize: theme.typography.h4.fontSize,
        fontWeight: theme.typography.fontWeightMedium,
        color: theme.colors.text.primary,
        margin: `${theme.spacing(0.83)} 0`,
      },

      // Paragraphs
      '& p': {
        margin: `${theme.spacing(0.5)} 0`,
        color: theme.colors.text.primary,
        lineHeight: 1.7,
      },

      // Lists
      '& ul, & ol': {
        paddingLeft: theme.spacing(3),
        margin: `${theme.spacing(0.5)} 0`,
        color: theme.colors.text.primary,
      },

      '& li': {
        margin: `${theme.spacing(0.25)} 0`,
        color: theme.colors.text.primary,
      },

      // Code
      '& code': {
        background: theme.colors.background.secondary,
        padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
        borderRadius: theme.shape.radius.default,
        fontFamily: theme.typography.fontFamilyMonospace,
        color: theme.colors.text.primary,
        fontSize: theme.typography.bodySmall.fontSize,
      },

      '& pre': {
        background: theme.colors.background.secondary,
        padding: theme.spacing(1.5),
        borderRadius: theme.shape.radius.default,
        overflowX: 'auto',
        border: `1px solid ${theme.colors.border.weak}`,

        '& code': {
          background: 'transparent',
          padding: 0,
          fontSize: theme.typography.bodySmall.fontSize,
        },
      },

      // Links
      '& a': {
        color: theme.colors.text.link,
        textDecoration: 'underline',

        '&:hover': {
          color: theme.colors.text.link,
          textDecoration: 'none',
        },
      },

      // ==========================================
      // ACTION BADGE STYLES
      // Base badge styling + color variants
      // ==========================================

      '& .action-badge': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
        borderRadius: '9999px', // Pill shape
        fontSize: '10px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        cursor: 'pointer',
        userSelect: 'none',
        marginRight: theme.spacing(0.5),
        transition: 'transform 0.15s ease-in-out, box-shadow 0.15s ease-in-out',
        lineHeight: 1,
        verticalAlign: 'middle',

        '&:hover': {
          transform: 'scale(1.05)',
          boxShadow: theme.shadows.z1,
        },

        '&:focus': {
          outline: `2px solid ${theme.colors.primary.main}`,
          outlineOffset: '1px',
        },
      },

      // Section badge - Blue
      '& .action-badge--sequence': {
        backgroundColor: colors.section.badge,
        color: colors.section.badgeText,
      },

      // Multistep badge - Purple
      '& .action-badge--multistep': {
        backgroundColor: colors.multistep.badge,
        color: colors.multistep.badgeText,
      },

      // Guided badge - Teal
      '& .action-badge--guided': {
        backgroundColor: colors.guided.badge,
        color: colors.guided.badgeText,
      },

      // Interactive step badges - Amber variants
      '& .action-badge--button, & .action-badge--highlight, & .action-badge--formfill, & .action-badge--hover, & .action-badge--navigate, & .action-badge--noop, & .action-badge--default':
        {
          backgroundColor: colors.interactive.badge,
          color: colors.interactive.badgeText,
        },

      // Note badge - Orange
      '& .action-badge--note': {
        backgroundColor: colors.note.badge,
        color: colors.note.badgeText,
      },

      // ==========================================
      // LEGACY INDICATOR STYLES (backwards compatibility)
      // ==========================================

      '& .interactive-lightning': {
        cursor: 'pointer',
        color: colors.interactive.badge,
        marginRight: theme.spacing(0.5),
        userSelect: 'none',
        display: 'inline-block',
        transition: 'transform 0.15s ease-in-out',

        '&:hover': {
          transform: 'scale(1.2)',
        },
      },

      '& .interactive-info-icon': {
        cursor: 'pointer',
        color: colors.note.badge,
        marginRight: theme.spacing(0.5),
        userSelect: 'none',
        display: 'inline-block',
        transition: 'transform 0.15s ease-in-out',
        fontSize: '1.1em',

        '&:hover': {
          transform: 'scale(1.2)',
        },
      },

      // ==========================================
      // ELEMENT TYPE STYLES
      // Color-coded backgrounds and borders
      // ==========================================

      // Interactive elements (default) - Amber
      '& .interactive': {
        border: `1px dashed ${colors.interactive.border}`,
        padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
        borderRadius: theme.shape.radius.default,
        background: colors.interactive.background,
      },

      // Sequence sections - Simple left border indicator
      // Target spans with data-targetaction="sequence" OR class="sequence-section"
      '& span[data-targetaction="sequence"], & .sequence-section': {
        display: 'block',
        // Override default interactive border with just a left border
        border: 'none',
        borderLeft: `3px solid ${colors.section.border}`,
        paddingLeft: theme.spacing(1.5),
        paddingTop: theme.spacing(0.5),
        paddingBottom: theme.spacing(0.5),
        margin: `${theme.spacing(1)} 0`,
        background: 'transparent',
        borderRadius: 0,
      },

      // Interactive comments / notes - Orange
      '& .interactive-comment': {
        display: 'inline !important',
        background: colors.note.background,
        borderBottom: `2px dotted ${colors.note.border}`,
        padding: `0 ${theme.spacing(0.25)}`,
      },

      // Multistep list items - Purple (dashed border)
      '& li.interactive[data-targetaction="multistep"]': {
        border: `1px dashed ${colors.multistep.border}`,
        padding: `${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
        borderRadius: theme.shape.radius.default,
        background: colors.multistep.background,
        marginTop: theme.spacing(0.5),
        marginBottom: theme.spacing(0.5),

        // Hide ALL badges inside nested elements (show only parent badge)
        '& .action-badge': {
          display: 'none !important',
        },
        // But show the FIRST badge (the parent multistep badge)
        '& > .action-badge': {
          display: 'inline-flex !important',
        },
        // Remove styling from nested interactive spans (they're steps, not standalone)
        '& span.interactive': {
          border: 'none',
          padding: 0,
          background: 'transparent',
          display: 'inline',
        },
        // Keep comments visible but inline
        '& .interactive-comment': {
          display: 'inline !important',
          background: 'transparent',
          borderBottom: 'none',
        },
      },

      // Guided list items - Teal (dashed border)
      '& li.interactive[data-targetaction="guided"]': {
        border: `1px dashed ${colors.guided.border}`,
        padding: `${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
        borderRadius: theme.shape.radius.default,
        background: colors.guided.background,
        marginTop: theme.spacing(0.5),
        marginBottom: theme.spacing(0.5),

        // Hide ALL badges inside nested elements (show only parent badge)
        '& .action-badge': {
          display: 'none !important',
        },
        // But show the FIRST badge (the parent guided badge)
        '& > .action-badge': {
          display: 'inline-flex !important',
        },
        // Remove styling from nested interactive spans (they're steps, not standalone)
        '& span.interactive': {
          border: 'none',
          padding: 0,
          background: 'transparent',
          display: 'inline',
        },
        // Keep comments visible but inline
        '& .interactive-comment': {
          display: 'inline !important',
          background: 'transparent',
          borderBottom: 'none',
        },
      },

      // Span-based multistep (inline context) - Purple
      '& span.interactive[data-targetaction="multistep"]': {
        border: `1px dashed ${colors.multistep.border}`,
        padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
        borderRadius: theme.shape.radius.default,
        background: colors.multistep.background,

        // Hide nested badges
        '& .action-badge:not(:first-child)': {
          display: 'none !important',
        },
        '& span.interactive .action-badge': {
          display: 'none !important',
        },
        '& span.interactive': {
          border: 'none',
          padding: 0,
          background: 'transparent',
        },
        '& .interactive-comment': {
          display: 'inline !important',
          background: 'transparent',
          borderBottom: 'none',
        },
      },

      // Span-based guided (inline context) - Teal
      '& span.interactive[data-targetaction="guided"]': {
        border: `1px dashed ${colors.guided.border}`,
        padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
        borderRadius: theme.shape.radius.default,
        background: colors.guided.background,

        // Hide nested badges
        '& .action-badge:not(:first-child)': {
          display: 'none !important',
        },
        '& span.interactive .action-badge': {
          display: 'none !important',
        },
        '& span.interactive': {
          border: 'none',
          padding: 0,
          background: 'transparent',
        },
        '& .interactive-comment': {
          display: 'inline !important',
          background: 'transparent',
          borderBottom: 'none',
        },
      },
    }),
  };
};

/**
 * Shared styles for editor wrapper and form panel
 * Ensures consistent sizing and layout
 */
export const getSharedPanelStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    overflow: 'hidden',
  }),
  content: css({
    flex: 1,
    overflow: 'auto',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.primary,
  }),
});

/**
 * Styles for multistep action form recorder UI
 */
export const getMultistepFormStyles = (theme: GrafanaTheme2) => ({
  // Recording status banner - prominent indicator at top of section
  recordingBanner: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    borderRadius: theme.shape.radius.default,
    marginBottom: theme.spacing(2),
    backgroundColor: theme.colors.error.transparent,
    border: `2px solid ${theme.colors.error.border}`,
    animation: 'recording-pulse 2s ease-in-out infinite',
    '@keyframes recording-pulse': {
      '0%, 100%': {
        borderColor: theme.colors.error.border,
        boxShadow: `0 0 0 0 ${theme.colors.error.main}00`,
      },
      '50%': {
        borderColor: theme.colors.error.main,
        boxShadow: `0 0 8px 2px ${theme.colors.error.main}40`,
      },
    },
  }),
  recordingBannerPaused: css({
    backgroundColor: theme.colors.warning.transparent,
    border: `2px solid ${theme.colors.warning.border}`,
    animation: 'none',
  }),
  recordingBannerText: css({
    flex: 1,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  recordingBannerDot: css({
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    backgroundColor: theme.colors.error.main,
    animation: 'blink-dot 1s ease-in-out infinite',
    '@keyframes blink-dot': {
      '0%, 100%': { opacity: 1, transform: 'scale(1)' },
      '50%': { opacity: 0.5, transform: 'scale(0.8)' },
    },
  }),
  recordingBannerDotPaused: css({
    backgroundColor: theme.colors.warning.main,
    animation: 'none',
  }),

  // Control buttons container
  controlsContainer: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  controlsRow: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
  }),
  controlButtons: css({
    display: 'flex',
    gap: theme.spacing(0.5),
  }),

  recordModeActive: css({
    animation: 'pulse 2s ease-in-out infinite',
    '@keyframes pulse': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.8 },
    },
  }),
  recordingDot: css({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: theme.colors.error.main,
    display: 'inline-block',
    marginRight: theme.spacing(0.5),
    animation: 'blink 1.5s ease-in-out infinite',
    '@keyframes blink': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.3 },
    },
  }),

  pausedModeActive: css({
    backgroundColor: theme.colors.warning.main,
    color: theme.colors.warning.contrastText,
    '&:hover': {
      backgroundColor: theme.colors.warning.shade,
    },
  }),

  pausedDot: css({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: theme.colors.warning.main,
    display: 'inline-block',
    marginRight: theme.spacing(0.5),
  }),
  stepCode: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.secondary,
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.default,
    display: 'block',
    wordBreak: 'break-all',
    overflowWrap: 'break-word',
  }),
  cardTitle: css({
    margin: 0,
    marginBottom: theme.spacing(1.5),
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  emptyState: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontStyle: 'italic',
  }),
  stepsLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(0.5),
    display: 'block',
  }),
  stepsContainer: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    maxHeight: '300px',
    overflowY: 'auto',
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  stepItem: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  stepBadge: css({
    flexShrink: 0,
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  }),
  stepContent: css({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    overflow: 'hidden',
  }),
  stepDescription: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    wordBreak: 'break-word',
    overflowWrap: 'break-word',
  }),
  stepBadges: css({
    marginTop: theme.spacing(0.5),
  }),
  alertIcon: css({
    marginRight: theme.spacing(1),
  }),
  clearButtonContainer: css({
    marginTop: theme.spacing(1.5),
  }),
  requirementsButtonContainer: css({
    marginTop: theme.spacing(1),
  }),
});
