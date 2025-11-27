import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

/**
 * Theme-aware styles for the WYSIWYG editor
 * Replaces hardcoded CSS with Grafana's theming system
 */
export const getEditorStyles = (theme: GrafanaTheme2) => {
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

      // Lightning bolt indicator for interactive elements
      '& .interactive-lightning': {
        cursor: 'pointer',
        color: '#FFD700', // Gold color for lightning - keeping as accent
        marginRight: theme.spacing(0.5),
        userSelect: 'none',
        display: 'inline-block',
        transition: 'transform 0.15s ease-in-out',

        '&:hover': {
          transform: 'scale(1.2)',
        },
      },

      // Info icon indicator for comment elements
      '& .interactive-info-icon': {
        cursor: 'pointer',
        color: theme.colors.info.text, // Blue color for info
        marginRight: theme.spacing(0.5),
        userSelect: 'none',
        display: 'inline-block',
        transition: 'transform 0.15s ease-in-out',
        fontSize: '1.1em',

        '&:hover': {
          transform: 'scale(1.2)',
        },
      },

      // Interactive elements visual feedback
      '& .interactive': {
        border: `1px dashed ${theme.colors.border.medium}`,
        padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
        borderRadius: theme.shape.radius.default,
        background: theme.isDark ? 'rgba(255, 215, 0, 0.08)' : 'rgba(255, 215, 0, 0.05)',
      },

      // Sequence sections
      '& .sequence-section': {
        border: `2px solid ${theme.colors.primary.border}`,
        borderRadius: theme.shape.radius.default,
        padding: theme.spacing(1.5),
        margin: `${theme.spacing(1)} 0`,
        background: theme.isDark ? 'rgba(74, 144, 226, 0.08)' : 'rgba(74, 144, 226, 0.05)',
      },

      // Interactive comments - override global hide rule
      '& .interactive-comment': {
        display: 'inline !important', // Override global hide rule
        background: theme.isDark ? 'rgba(255, 165, 0, 0.2)' : 'rgba(255, 165, 0, 0.15)',
        borderBottom: `2px dotted ${theme.colors.border.medium}`,
        padding: `0 ${theme.spacing(0.25)}`,
      },

      // Multistep: Hide nested lightning bolts and their containers
      // Only show the outer lightning bolt on the multistep container itself
      '& li.interactive[data-targetaction="multistep"]': {
        // Hide lightning bolts inside nested interactive spans
        '& span.interactive .interactive-lightning': {
          display: 'none !important',
        },
        // Hide border and background of nested interactive spans
        // Info icons remain visible because they have their own display rules
        '& span.interactive': {
          border: 'none',
          padding: 0,
          background: 'transparent',
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
