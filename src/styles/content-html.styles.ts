import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

// Base shared styles for both journey and docs content
const getBaseContentStyles = (theme: GrafanaTheme2) => ({
  // Base container and layout
  padding: theme.spacing(3),
  overflow: 'auto',
  flex: 1,
  lineHeight: 1.6,
  fontSize: theme.typography.body.fontSize,

  // Ensure container can handle wide content
  minWidth: 0,
  maxWidth: '100%',
  wordWrap: 'break-word',
  overflowWrap: 'break-word',

  // Reset word wrapping for code elements specifically
  '& pre, & pre code': {
    wordWrap: 'normal',
    overflowWrap: 'normal',
  },

  // Basic HTML elements styling
  '& h1, & h2, & h3, & h4, & h5, & h6': {
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    marginBottom: theme.spacing(2),
    marginTop: theme.spacing(3),
    lineHeight: 1.3,

    '&:first-child': {
      marginTop: 0,
    },
  },

  '& h1': {
    fontSize: theme.typography.h2.fontSize,
    borderBottom: `2px solid ${theme.colors.border.medium}`,
    paddingBottom: theme.spacing(1),
    marginBottom: theme.spacing(3),
  },

  '& h2': {
    fontSize: theme.typography.h3.fontSize,
    marginTop: theme.spacing(4),
  },

  '& h3': {
    fontSize: theme.typography.h4.fontSize,
    marginTop: theme.spacing(3),
  },

  '& h4': {
    fontSize: theme.typography.h5.fontSize,
    marginTop: theme.spacing(2),
  },

  '& p': {
    marginBottom: theme.spacing(2),
    lineHeight: 1.7,
    color: theme.colors.text.primary,
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
  },

  '& ul, & ol': {
    marginBottom: theme.spacing(2),
    paddingLeft: theme.spacing(3),

    '& li': {
      marginBottom: theme.spacing(1),
      lineHeight: 1.6,
    },
  },

  // Links
  '& a': {
    color: theme.colors.primary.main,
    textDecoration: 'none',
    '&:hover': {
      textDecoration: 'underline',
    },
  },

  // Inline code styling
  '& code:not(pre code)': {
    position: 'relative',
    backgroundColor: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: '3px',
    padding: `2px 4px`,
    paddingRight: '24px',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: '0.9em',
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
  },

  // Code blocks - shared styling
  '& pre': {
    position: 'relative',
    backgroundColor: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    margin: `${theme.spacing(2)} 0`,
    padding: `${theme.spacing(2)} ${theme.spacing(10)} ${theme.spacing(2)} ${theme.spacing(2)}`,
    overflow: 'hidden',
    overflowX: 'auto',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.5,
    color: theme.colors.text.primary,
    whiteSpace: 'pre',
    maxWidth: '100%',

    '& code': {
      backgroundColor: 'transparent',
      padding: 0,
      border: 'none',
      borderRadius: 0,
      fontFamily: 'inherit',
      fontSize: 'inherit',
      color: 'inherit',
      fontWeight: 'inherit',
      whiteSpace: 'pre',
      wordBreak: 'normal',
      overflowWrap: 'normal',
    },

    // Custom scrollbar styling
    '&::-webkit-scrollbar': {
      height: '8px',
      width: '8px',
    },

    '&::-webkit-scrollbar-track': {
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
    },

    '&::-webkit-scrollbar-thumb': {
      backgroundColor: theme.colors.border.medium,
      borderRadius: theme.shape.radius.default,
      border: `2px solid ${theme.colors.background.secondary}`,

      '&:hover': {
        backgroundColor: theme.colors.border.strong,
      },
    },

    '&::-webkit-scrollbar:horizontal': {
      height: '12px',
    },

    '&::-webkit-scrollbar-thumb:horizontal': {
      backgroundColor: theme.colors.border.medium,
      borderRadius: theme.shape.radius.default,
      border: `2px solid ${theme.colors.background.canvas}`,

      '&:hover': {
        backgroundColor: theme.colors.border.strong,
      },
    },

    '&::-webkit-scrollbar-track:horizontal': {
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      margin: `0 ${theme.spacing(1)}`,
    },

    // Mobile responsive handling
    [theme.breakpoints.down('sm')]: {
      padding: `${theme.spacing(1.5)} ${theme.spacing(8)} ${theme.spacing(1.5)} ${theme.spacing(1.5)}`,
      fontSize: '12px',
      lineHeight: 1.4,

      '&::-webkit-scrollbar': {
        height: '6px',
      },

      '&::-webkit-scrollbar:horizontal': {
        height: '8px',
      },
    },

    '@media (max-width: 480px)': {
      padding: `${theme.spacing(1)} ${theme.spacing(6)} ${theme.spacing(1)} ${theme.spacing(1)}`,
      fontSize: '11px',

      '& .code-copy-button': {
        padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
        fontSize: '10px',
        minWidth: '50px',

        '& .copy-text': {
          display: 'none',
        },
      },
    },
  },

  // Shared code copy button styles
  '& .code-copy-button': {
    position: 'absolute',
    top: theme.spacing(1),
    right: theme.spacing(1),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    zIndex: 2,
    minWidth: '70px',
    justifyContent: 'center',

    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
      color: theme.colors.text.primary,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },

    '&:active': {
      transform: 'translateY(0)',
      boxShadow: 'none',
    },

    '&.copied': {
      backgroundColor: theme.colors.success.main,
      borderColor: theme.colors.success.border,
      color: theme.colors.success.contrastText,

      '&:hover': {
        backgroundColor: theme.colors.success.main,
        borderColor: theme.colors.success.border,
        color: theme.colors.success.contrastText,
      },
    },

    '& svg': {
      flexShrink: 0,
      width: '16px',
      height: '16px',
    },

    '& .copy-text': {
      whiteSpace: 'nowrap',
      fontSize: '12px',
    },
  },

  // Inline code copy button
  '& .inline-code-copy-button': {
    position: 'absolute',
    top: '50%',
    right: '2px',
    transform: 'translateY(-50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    padding: '2px',
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: '2px',
    color: theme.colors.text.secondary,
    fontSize: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    zIndex: 2,
    opacity: 0.7,

    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
      color: theme.colors.text.primary,
      opacity: 1,
      transform: 'translateY(-50%) scale(1.1)',
    },

    '&:active': {
      transform: 'translateY(-50%) scale(1)',
    },

    '&.copied': {
      backgroundColor: theme.colors.success.main,
      borderColor: theme.colors.success.border,
      color: theme.colors.success.contrastText,
      opacity: 1,

      '&:hover': {
        backgroundColor: theme.colors.success.main,
        borderColor: theme.colors.success.border,
        color: theme.colors.success.contrastText,
      },
    },

    '& svg': {
      flexShrink: 0,
      width: '12px',
      height: '12px',
    },
  },

  // Shared iframe and video styles
  '& iframe.journey-iframe': {
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z1,
  },

  '& iframe.journey-general-iframe': {
    maxWidth: '100%',
    height: 'auto',
    minHeight: '200px',
    margin: `${theme.spacing(2)} auto`,
    display: 'block',
  },

  '& .journey-iframe-wrapper.journey-video-wrapper': {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    margin: `${theme.spacing(2)} auto`,
    paddingBottom: '56.25%',
    height: 0,
    overflow: 'hidden',
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z1,
  },

  '& .journey-video-wrapper iframe.journey-video-iframe': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: theme.shape.radius.default,
  },

  '& video': {
    width: '100%',
    height: 'auto',
    maxWidth: '100%',
    minWidth: '320px',
    minHeight: '180px',
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    boxShadow: theme.shadows.z2,
    margin: `${theme.spacing(2)} 0`,
    backgroundColor: theme.colors.background.canvas,

    [theme.breakpoints.down('sm')]: {
      minWidth: '280px',
      minHeight: '160px',
    },

    [theme.breakpoints.up('lg')]: {
      maxWidth: '800px',
      margin: `${theme.spacing(3)} auto`,
      display: 'block',
    },

    '&:hover': {
      boxShadow: theme.shadows.z3,
      borderColor: theme.colors.border.medium,
    },
  },

  '& .video-container': {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    margin: `${theme.spacing(2)} 0`,

    '& video': {
      margin: 0,
    },
  },

  '& video.docs-video': {
    minWidth: '320px',
    minHeight: '180px',
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z2,

    [theme.breakpoints.down('sm')]: {
      minWidth: '280px',
      minHeight: '160px',
    },

    [theme.breakpoints.up('lg')]: {
      maxWidth: '900px',
      margin: `${theme.spacing(3)} auto`,
      display: 'block',
    },
  },

  '& video.lazyload': {
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,

    '&[data-video-enhanced]': {
      transition: 'opacity 0.3s ease',
    },
  },

  '& iframe:not([class])': {
    maxWidth: '100%',
    width: '100%',
    height: 'auto',
    margin: `${theme.spacing(2)} 0`,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z1,
    minHeight: '315px',

    [theme.breakpoints.down('md')]: {
      minHeight: '250px',
    },

    [theme.breakpoints.down('sm')]: {
      minHeight: '200px',
    },
  },

  '& iframe': {
    maxWidth: '100%',

    '&[width]': {
      width: '100% !important',
      height: 'auto !important',
      aspectRatio: '16 / 9',
      minHeight: '315px',

      [theme.breakpoints.down('md')]: {
        minHeight: '250px',
      },

      [theme.breakpoints.down('sm')]: {
        minHeight: '200px',
      },
    },
  },

  // Shared admonition styles
  '& .admonition': {
    all: 'unset',
    display: 'contents',
  },

  '& blockquote': {
    margin: `${theme.spacing(2)} 0`,
    padding: theme.spacing(2),
    borderLeft: `4px solid ${theme.colors.border.medium}`,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontStyle: 'normal',

    '& .title, & .admonition-title': {
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      marginBottom: theme.spacing(1),
      marginTop: 0,
      color: theme.colors.text.primary,
      fontStyle: 'normal',
    },

    '& p': {
      margin: `${theme.spacing(0.5)} 0`,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.4,
      color: theme.colors.text.primary,
      fontStyle: 'normal',

      '&:last-child': {
        marginBottom: 0,
      },
    },
  },

  // Admonition types
  '& .admonition-note blockquote': {
    borderLeftColor: theme.colors.info.main,

    '& .title, & .admonition-title': {
      color: theme.colors.info.main,

      '&:before': {
        content: '"ℹ️ "',
      },
    },
  },

  '& .admonition-warning blockquote, & .admonition-caution blockquote': {
    borderLeftColor: theme.colors.warning.main,

    '& .title, & .admonition-title': {
      color: theme.colors.warning.main,

      '&:before': {
        content: '"⚠️ "',
      },
    },
  },

  '& .admonition-tip blockquote': {
    borderLeftColor: theme.colors.success.main,

    '& .title, & .admonition-title': {
      color: theme.colors.success.main,

      '&:before': {
        content: '"💡 "',
      },
    },
  },

  // Tables
  '& table': {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: theme.typography.body.fontSize,
    lineHeight: 1.5,
    margin: `${theme.spacing(2)} 0`,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',

    '& thead': {
      backgroundColor: theme.colors.background.canvas,
      borderBottom: `2px solid ${theme.colors.border.medium}`,

      '& th': {
        padding: theme.spacing(1.5),
        textAlign: 'left',
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.text.primary,
        fontSize: theme.typography.body.fontSize,
        borderRight: `1px solid ${theme.colors.border.weak}`,

        '&:last-child': {
          borderRight: 'none',
        },
      },
    },

    '& tbody': {
      '& tr': {
        borderBottom: `1px solid ${theme.colors.border.weak}`,
        transition: 'background-color 0.2s ease',

        '&:hover': {
          backgroundColor: theme.colors.action.hover,
        },

        '&:last-child': {
          borderBottom: 'none',
        },
      },

      '& td': {
        padding: theme.spacing(1.5),
        verticalAlign: 'top',
        borderRight: `1px solid ${theme.colors.border.weak}`,
        color: theme.colors.text.primary,

        '&:last-child': {
          borderRight: 'none',
        },
      },
    },
  },

  // Shared collapsible and expandable components
  '& .journey-collapse': {
    margin: `${theme.spacing(2)} 0`,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  },

  '& .journey-collapse-trigger': {
    width: '100%',
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.canvas,
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    transition: 'background-color 0.2s ease',

    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  },

  '& .journey-collapse-icon': {
    transition: 'transform 0.2s ease',
    color: theme.colors.text.secondary,
    fontSize: '12px',

    '&.collapsed': {
      transform: 'rotate(-90deg)',
    },
  },

  '& .journey-collapse-content': {
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.primary,
    borderTop: `1px solid ${theme.colors.border.weak}`,
  },

  '& .expandable-table': {
    margin: `${theme.spacing(2)} 0`,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  },

  '& .expandable-table-toggle-btn': {
    width: '100%',
    margin: 0,
    borderRadius: 0,
    justifyContent: 'center',
  },

  '& .expandable-table-content': {
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.primary,
    borderTop: `1px solid ${theme.colors.border.weak}`,

    '&.collapsed': {
      display: 'none',
    },
  },

  // Shared utility classes and components (lots of shared journey-specific styling)
  '& .journey-ready-to-begin': {
    margin: `${theme.spacing(4)} 0`,
    padding: theme.spacing(3),
    backgroundColor: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    textAlign: 'center',
  },

  '& .journey-ready-container h3': {
    marginBottom: theme.spacing(2),
    color: theme.colors.text.primary,
  },

  '& .journey-ready-button': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: `${theme.spacing(1.5)} ${theme.spacing(3)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',

    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z2,
    },
  },

  '& .journey-ready-icon': {
    fontSize: '14px',
    lineHeight: 1,
  },

  '& .journey-ready-description': {
    marginTop: theme.spacing(1.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
  },

  // Override inline-block utility for images to maintain responsiveness
  '& img.d-inline-block': {
    display: 'block !important',
    width: '100%',
    maxWidth: '100%',
  },
});

// Journey-specific styles and overrides
const getJourneySpecificStyles = (theme: GrafanaTheme2) => ({
  // Journey-specific image handling with content-image class
  '& img.content-image': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    margin: `${theme.spacing(2)} auto`,
    display: 'block',
    boxShadow: theme.shadows.z1,
    transition: 'all 0.2s ease',
    cursor: 'zoom-in',

    '&:hover': {
      boxShadow: theme.shadows.z2,
      transform: 'scale(1.02)',
      borderColor: theme.colors.primary.main,
    },

    '&.d-inline-block': {
      display: 'block !important',
      width: '100%',
      maxWidth: '100%',
    },

    '&.lazyload': {
      width: '100%',
      maxWidth: '100%',
      height: 'auto',
    },

    // Journey-specific image override
    '&.journey-conclusion-header': {
      cursor: 'default',
      '&:hover': {
        transform: 'none',
        borderColor: theme.colors.border.weak,
      },
    },
  },

  // Journey-specific standalone code blocks
  '& pre.journey-standalone-code': {
    backgroundColor: theme.colors.background.secondary,
    borderLeft: `3px solid ${theme.colors.primary.main}`,
    maxWidth: '100%',
    overflow: 'hidden',
    overflowX: 'auto',
    whiteSpace: 'pre',
    wordBreak: 'normal',
    overflowWrap: 'normal',

    '&::-webkit-scrollbar': {
      height: '6px',
    },

    '&::-webkit-scrollbar-track': {
      backgroundColor: theme.colors.background.canvas,
    },

    '&::-webkit-scrollbar-thumb': {
      backgroundColor: theme.colors.border.medium,
      borderRadius: '3px',
    },
  },

  // Journey-specific components that aren't in docs
  '& .journey-start-section': {
    margin: `${theme.spacing(4)} 0`,
    padding: theme.spacing(3),
    backgroundColor: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    textAlign: 'center',
  },

  '& .journey-start-container h3': {
    marginBottom: theme.spacing(2),
    color: theme.colors.text.primary,
  },

  '& .journey-start-button': {
    padding: `${theme.spacing(1.5)} ${theme.spacing(3)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',

    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z2,
    },
  },

  // Side journeys and related journeys - these are journey-specific
  '& .journey-side-journeys': {
    margin: `${theme.spacing(3)} 0`,
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  },

  '& .journey-side-journeys-title': {
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(2),
    marginTop: 0,
  },

  '& .journey-side-journeys-list': {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },

  '& .journey-side-journey-item': {
    margin: 0,
    padding: 0,
  },

  '& .journey-side-journey-link': {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    textDecoration: 'none',
    color: theme.colors.text.primary,
    transition: 'all 0.2s ease',
    width: '100%',
    boxSizing: 'border-box',

    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
      textDecoration: 'none',
      color: theme.colors.text.primary,
    },

    '&:after': {
      content: '"↗"',
      color: theme.colors.text.secondary,
      fontSize: '14px',
      marginLeft: 'auto',
      flexShrink: 0,
    },
  },

  // Legacy styles for backward compatibility
  '& .journey-side-journey-icon-circle': {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  '& .journey-side-journey-content': {
    flex: 1,
    minWidth: 0,
  },

  '& .journey-side-journey-title': {
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: theme.typography.body.fontSize,
    marginBottom: theme.spacing(0.5),
  },

  '& .journey-side-journey-type': {
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  },

  '& .journey-side-journey-external-icon': {
    color: theme.colors.text.secondary,
    flexShrink: 0,
  },

  // Related journeys section
  '& .journey-related-journeys-section, & .journey-related-journeys': {
    margin: `${theme.spacing(3)} 0`,
  },

  '& .journey-related-journeys-title': {
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(2),
    marginTop: 0,
  },

  '& .journey-related-journeys-list': {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },

  '& .journey-related-journey-item': {
    margin: 0,
    padding: 0,
  },

  '& .journey-related-journey-link': {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    textDecoration: 'none',
    color: theme.colors.text.primary,
    transition: 'all 0.2s ease',
    width: '100%',
    boxSizing: 'border-box',

    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
      textDecoration: 'none',
      color: theme.colors.text.primary,
    },

    '&:after': {
      content: '"↗"',
      color: theme.colors.text.secondary,
      fontSize: '14px',
      marginLeft: 'auto',
      flexShrink: 0,
    },
  },

  '& .journey-related-journey-icon-circle': {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: theme.colors.info.main,
    color: theme.colors.info.contrastText,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  '& .journey-related-journey-content': {
    flex: 1,
    minWidth: 0,
  },

  '& .journey-related-journey-title': {
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: theme.typography.body.fontSize,
  },

  // Orange outline list styling (from learning journeys)
  '& .orange-outline-list': {
    borderRadius: '12px',
    border: '2px solid #ff671d',
    padding: theme.spacing(1.5),
    paddingBottom: theme.spacing(1),
    backgroundColor: theme.colors.background.primary,
    margin: `${theme.spacing(2)} 0`,

    '& .icon-heading': {
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(1.5),
      marginBottom: theme.spacing(1),

      '& .icon-heading__container': {
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '30px',
        height: '30px',
      },

      '& h2': {
        margin: 0,
        fontSize: theme.typography.h4.fontSize,
        fontWeight: theme.typography.fontWeightMedium,
        color: theme.colors.text.primary,
        lineHeight: 1.3,
      },
    },

    '& p': {
      marginBottom: theme.spacing(1.5),
    },

    '& ul': {
      marginBottom: 0,

      '& li': {
        marginBottom: theme.spacing(0.5),

        '&:last-child': {
          marginBottom: 0,
        },
      },
    },
  },

  // Bottom navigation
  '& .journey-bottom-navigation': {
    margin: `${theme.spacing(4)} 0 ${theme.spacing(2)} 0`,
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  },

  '& .journey-bottom-navigation-content': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
  },

  '& .journey-bottom-nav-container': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    width: '100%',
  },

  '& .journey-progress-indicator': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    minWidth: '60px',
    textAlign: 'center',
  },

  '& .journey-bottom-nav-button': {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    minWidth: '100px',

    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.primary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },

    '&:disabled': {
      backgroundColor: theme.colors.action.disabledBackground,
      color: theme.colors.action.disabledText,
      cursor: 'not-allowed',
      opacity: 0.5,
    },

    '& svg': {
      width: '16px',
      height: '16px',
      flexShrink: 0,
    },
  },

  '& .journey-bottom-nav-info': {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  },

  '& .journey-bottom-nav-milestone': {
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
  },
});

// Docs-specific styles and overrides
const getDocsSpecificStyles = (theme: GrafanaTheme2) => ({
  // Docs uses generic img selector instead of img.content-image
  '& img': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    margin: `${theme.spacing(2)} auto`,
    display: 'block',
    boxShadow: theme.shadows.z1,
    transition: 'all 0.2s ease',
    cursor: 'zoom-in',

    '&:hover': {
      boxShadow: theme.shadows.z2,
      transform: 'scale(1.02)',
      borderColor: theme.colors.primary.main,
    },

    '&.d-inline-block': {
      display: 'block !important',
      width: '100%',
      maxWidth: '100%',
    },

    '&.lazyload': {
      width: '100%',
      maxWidth: '100%',
      height: 'auto',
    },

    '&.content-image': {
      width: '100%',
      maxWidth: '100%',
    },
  },

  // Docs-specific standalone code blocks
  '& pre.docs-standalone-code': {
    backgroundColor: theme.colors.background.secondary,
    borderLeft: `3px solid ${theme.colors.primary.main}`,
    maxWidth: '100%',
    overflow: 'hidden',
    overflowX: 'auto',
    whiteSpace: 'pre',
    wordBreak: 'normal',
    overflowWrap: 'normal',

    '&::-webkit-scrollbar': {
      height: '6px',
    },

    '&::-webkit-scrollbar-track': {
      backgroundColor: theme.colors.background.canvas,
    },

    '&::-webkit-scrollbar-thumb': {
      backgroundColor: theme.colors.border.medium,
      borderRadius: '3px',
    },
  },

  // Docs-specific blockquote fallback (non-admonition)
  '& blockquote:not(.admonition blockquote)': {
    margin: `${theme.spacing(2)} 0`,
    padding: theme.spacing(2),
    borderLeft: `4px solid ${theme.colors.border.medium}`,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.body.fontSize,
    fontStyle: 'italic',
    color: theme.colors.text.secondary,

    '& p': {
      margin: `${theme.spacing(0.5)} 0`,
      fontSize: 'inherit',
      lineHeight: 1.6,
      color: 'inherit',
      fontStyle: 'inherit',

      '&:last-child': {
        marginBottom: 0,
      },
    },
  },
});

// Shared utility/promotional styles (used by both)
const getSharedUtilityStyles = (theme: GrafanaTheme2) => ({
  // Card-based content grids
  '& .card-content-grid': {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: theme.spacing(2),
    margin: `${theme.spacing(3)} 0`,
    width: '100%',

    '@media (max-width: 768px)': {
      gridTemplateColumns: '1fr',
      gap: theme.spacing(1.5),
    },
  },

  '& .card': {
    display: 'block',
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    textDecoration: 'none',
    color: 'inherit',
    transition: 'all 0.2s ease',
    overflow: 'hidden',
    height: '100%',

    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
      transform: 'translateY(-2px)',
      boxShadow: theme.shadows.z2,
      textDecoration: 'none',
      color: 'inherit',
    },

    '&:active': {
      transform: 'translateY(-1px)',
    },
  },

  '& .card-content-container': {
    padding: theme.spacing(2),
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
  },

  '& .card-title': {
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.3,
    color: theme.colors.text.primary,
    margin: 0,
    marginBottom: theme.spacing(0.75),
    display: '-webkit-box',
    '-webkit-line-clamp': '2',
    '-webkit-box-orient': 'vertical',
    overflow: 'hidden',
    width: '100%',
  },

  '& .card-description': {
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    lineHeight: 1.4,
    margin: 0,
    flex: 1,
    display: '-webkit-box',
    '-webkit-line-clamp': '3',
    '-webkit-box-orient': 'vertical',
    overflow: 'hidden',
    width: '100%',
  },

  '& .card.sm': { minHeight: '120px' },
  '& .card.md': { minHeight: '160px' },
  '& .card.lg': { minHeight: '200px' },

  // Utility classes
  '& .mt-1': { marginTop: theme.spacing(1) },
  '& .p-1': { padding: theme.spacing(1) },
  '& .p-2': { padding: theme.spacing(1.5) },
  '& .pt-0': { paddingTop: 0 },
  '& .pb-half': { paddingBottom: theme.spacing(0.25) },
  '& .pr-1': { paddingRight: theme.spacing(0.75) },
  '& .mb-1': { marginBottom: theme.spacing(0.75) },
  '& .mx-auto': { marginLeft: 'auto', marginRight: 'auto' },
  '& .d-flex': { display: 'flex' },
  '& .flex-direction-column': { flexDirection: 'column' },
  '& .flex-direction-row-reverse': {
    flexDirection: 'row-reverse',
    '@media (max-width: 768px)': { flexDirection: 'column' },
  },
  '& .align-items-start': { alignItems: 'flex-start' },
  '& .justify-content-start': { justifyContent: 'flex-start' },
  '& .fw-400': { fontWeight: 400 },
  '& .fw-500': { fontWeight: 500 },
  '& .fw-600': { fontWeight: 600 },
  '& .lh-2': { lineHeight: 1.3 },
  '& .text-gray-16': { color: theme.colors.text.primary },
  '& .text-gray-12': { color: theme.colors.text.secondary },
  '& .body-default': { fontSize: theme.typography.body.fontSize },
  '& .body-small': { fontSize: theme.typography.bodySmall.fontSize },
  '& .bg-gray-1': { backgroundColor: theme.colors.background.secondary },
  '& .br-12': { borderRadius: '8px' },
  '& .br-8': { borderRadius: '6px' },
  '& .w-175': { minWidth: '140px' },

  '& .d-sm-flex': {
    display: 'flex',
    gap: theme.spacing(1.5),
    alignItems: 'center',

    '@media (max-width: 768px)': {
      flexDirection: 'column',
      textAlign: 'center',
      gap: theme.spacing(1),
    },
  },

  '& .h4': {
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
    lineHeight: 1.2,
  },

  // Button styles (Grafana Play and other promotional components)
  '& .btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.75),
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    textDecoration: 'none',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap',

    '&:hover': {
      textDecoration: 'none',
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z2,
    },

    '&:active': {
      transform: 'translateY(0)',
    },
  },

  '& .btn--primary': {
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,

    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      color: theme.colors.primary.contrastText,
    },
  },

  '& .btn--large': {
    padding: `${theme.spacing(1.25)} ${theme.spacing(2.5)}`,
    fontSize: theme.typography.body.fontSize,
    minHeight: '36px',
  },

  '& .btn.arrow': {
    position: 'relative',

    '&:after': {
      content: '"→"',
      marginLeft: theme.spacing(0.75),
      fontSize: '1.1em',
      transition: 'transform 0.2s ease',
    },

    '&:hover:after': {
      transform: 'translateX(2px)',
    },
  },

  '& .lazyload': {
    maxWidth: '160px',
    height: 'auto',
    borderRadius: theme.shape.radius.default,

    '@media (max-width: 768px)': {
      maxWidth: '120px',
      marginBottom: theme.spacing(1),
    },
  },
});

// Main export functions that combine base + specific styles
export const journeyContentHtml = (theme: GrafanaTheme2) => css`
  ${css(getBaseContentStyles(theme) as any)}
  ${css(getJourneySpecificStyles(theme) as any)}
  ${css(getSharedUtilityStyles(theme) as any)}
`;

export const docsContentHtml = (theme: GrafanaTheme2) => css`
  ${css(getBaseContentStyles(theme) as any)}
  ${css(getDocsSpecificStyles(theme) as any)}
  ${css(getSharedUtilityStyles(theme) as any)}
`;
