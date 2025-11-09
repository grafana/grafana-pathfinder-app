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

      // Interactive elements visual feedback
      '& .interactive': {
        border: `1px dashed ${theme.colors.border.medium}`,
        padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
        borderRadius: theme.shape.radius.default,
        background: theme.isDark
          ? 'rgba(255, 215, 0, 0.08)'
          : 'rgba(255, 215, 0, 0.05)',
      },

      // Sequence sections
      '& .sequence-section': {
        border: `2px solid ${theme.colors.primary.border}`,
        borderRadius: theme.shape.radius.default,
        padding: theme.spacing(1.5),
        margin: `${theme.spacing(1)} 0`,
        background: theme.isDark
          ? 'rgba(74, 144, 226, 0.08)'
          : 'rgba(74, 144, 226, 0.05)',
      },

      // Interactive comments
      '& .interactive-comment': {
        background: theme.isDark
          ? 'rgba(255, 165, 0, 0.2)'
          : 'rgba(255, 165, 0, 0.15)',
        borderBottom: `2px dotted ${theme.colors.border.medium}`,
        padding: `0 ${theme.spacing(0.25)}`,
      },
    }),
  };
};

