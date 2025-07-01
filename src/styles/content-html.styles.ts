import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const journeyContentHtml = (theme: GrafanaTheme2) => css({
  padding: theme.spacing(3),
  overflow: 'auto',
  flex: 1,
  lineHeight: 1.6,
  fontSize: theme.typography.body.fontSize,
  
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
  
  // Images - responsive and well-styled with lightbox cursor
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
    
    '&.journey-conclusion-header': {
      cursor: 'default',
      
      '&:hover': {
        transform: 'none',
        borderColor: theme.colors.border.weak,
      },
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
  
  // Code blocks
  '& pre': {
    position: 'relative',
    backgroundColor: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    margin: `${theme.spacing(2)} 0`,
    padding: `${theme.spacing(2)} ${theme.spacing(10)} ${theme.spacing(2)} ${theme.spacing(2)}`,
    overflow: 'auto',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.5,
    color: theme.colors.text.primary,
    wordBreak: 'break-all',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    
    '& code': {
      backgroundColor: 'transparent',
      padding: 0,
      border: 'none',
      borderRadius: 0,
      fontFamily: 'inherit',
      fontSize: 'inherit',
      color: 'inherit',
      fontWeight: 'inherit',
    },
    
    // Custom scrollbar
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
  },

  // Code block copy button
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

  // Responsive iframe styling
  '& iframe.journey-iframe': {
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z1,
  },

  // General iframe responsiveness
  '& iframe.journey-general-iframe': {
    maxWidth: '100%',
    height: 'auto',
    minHeight: '200px',
    margin: `${theme.spacing(2)} auto`,
    display: 'block',
  },

  // Video iframe wrapper for maintaining aspect ratio
  '& .journey-iframe-wrapper.journey-video-wrapper': {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    margin: `${theme.spacing(2)} auto`,
    paddingBottom: '56.25%', // 16:9 aspect ratio
    height: 0,
    overflow: 'hidden',
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z1,
  },

  // Video iframe positioned absolutely within wrapper
  '& .journey-video-wrapper iframe.journey-video-iframe': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: theme.shape.radius.default,
  },

  // Video element styling for responsive behavior
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
    
    // Responsive sizing
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

  // Video container for better organization
  '& .video-container': {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    margin: `${theme.spacing(2)} 0`,
    
    '& video': {
      margin: 0,
    },
  },

  // Docs video specific styling
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

  // Lazy loading video styling
  '& video.lazyload': {
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    
    '&[data-video-enhanced]': {
      transition: 'opacity 0.3s ease',
    },
  },

  // Hide admonition wrapper - style blockquotes directly
  '& .admonition': {
    all: 'unset',
    display: 'contents',
  },

  // Blockquotes (including admonitions)
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

  // Specific admonition types based on class names
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

  // Standalone code blocks (converted from standalone <code> elements)
  '& pre.journey-standalone-code': {
    backgroundColor: theme.colors.background.secondary,
    borderLeft: `3px solid ${theme.colors.primary.main}`,
    maxWidth: '100%',
    overflowX: 'auto',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    
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

  // Journey start section
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

  // Collapsible sections
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
    
    '&.collapsed': {
      transform: 'rotate(-90deg)',
    },
  },

  '& .journey-collapse-content': {
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.primary,
    borderTop: `1px solid ${theme.colors.border.weak}`,
  },

  // Side journeys section
  '& .journey-side-journeys-section': {
    margin: `${theme.spacing(3)} 0`,
  },

  '& .journey-side-journeys-list': {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },

  '& .journey-side-journey-item': {
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
    
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
      textDecoration: 'none',
    },
  },

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
  '& .journey-related-journeys-section': {
    margin: `${theme.spacing(3)} 0`,
  },

  '& .journey-related-journeys-list': {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },

  '& .journey-related-journey-item': {
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
    
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
      textDecoration: 'none',
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

export const docsContentHtml = (theme: GrafanaTheme2) => css({
  padding: theme.spacing(3),
  overflow: 'auto',
  flex: 1,
  lineHeight: 1.6,
  fontSize: theme.typography.body.fontSize,
  
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
  
  // Images - responsive and well-styled with lightbox cursor
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
  
  // Code blocks
  '& pre': {
    position: 'relative',
    backgroundColor: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    margin: `${theme.spacing(2)} 0`,
    padding: `${theme.spacing(2)} ${theme.spacing(10)} ${theme.spacing(2)} ${theme.spacing(2)}`,
    overflow: 'auto',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.5,
    color: theme.colors.text.primary,
    wordBreak: 'break-all',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    
    '& code': {
      backgroundColor: 'transparent',
      padding: 0,
      border: 'none',
      borderRadius: 0,
      fontFamily: 'inherit',
      fontSize: 'inherit',
      color: 'inherit',
      fontWeight: 'inherit',
    },
    
    // Custom scrollbar
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
  },

  // Code block copy button
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

  // Responsive iframe styling
  '& iframe.journey-iframe': {
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z1,
  },

  // General iframe responsiveness
  '& iframe.journey-general-iframe': {
    maxWidth: '100%',
    height: 'auto',
    minHeight: '200px',
    margin: `${theme.spacing(2)} auto`,
    display: 'block',
  },

  // Video iframe wrapper for maintaining aspect ratio
  '& .journey-iframe-wrapper.journey-video-wrapper': {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    margin: `${theme.spacing(2)} auto`,
    paddingBottom: '56.25%', // 16:9 aspect ratio
    height: 0,
    overflow: 'hidden',
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z1,
  },

  // Video iframe positioned absolutely within wrapper
  '& .journey-video-wrapper iframe.journey-video-iframe': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: theme.shape.radius.default,
  },

  // Video element styling for responsive behavior
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
    
    // Responsive sizing
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

  // Video container for better organization
  '& .video-container': {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    margin: `${theme.spacing(2)} 0`,
    
    '& video': {
      margin: 0,
    },
  },

  // Docs video specific styling
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

  // Lazy loading video styling
  '& video.lazyload': {
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    
    '&[data-video-enhanced]': {
      transition: 'opacity 0.3s ease',
    },
  },

  // Simple admonitions - matching learning journey style
  '& .admonition': {
    all: 'unset',
    display: 'contents',
  },

  // Blockquotes (including admonitions) - simple learning journey style
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

  // Specific admonition types - simple learning journey style
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

  // Fallback blockquotes (non-admonition)
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

  // Standalone code blocks (converted from standalone <code> elements)
  '& pre.docs-standalone-code': {
    backgroundColor: theme.colors.background.secondary,
    borderLeft: `3px solid ${theme.colors.primary.main}`,
    maxWidth: '100%',
    overflowX: 'auto',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    
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

  // Card-based content grids
  '& .card-content-grid': {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: theme.spacing(2),
    margin: `${theme.spacing(3)} 0`,
    width: '100%',
    
    // Responsive adjustments
    '@media (max-width: 768px)': {
      gridTemplateColumns: '1fr',
      gap: theme.spacing(1.5),
    },
  },

  // Individual card styling
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

  // Card content container
  '& .card-content-container': {
    padding: theme.spacing(2),
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
  },

  // Card title
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

  // Card description
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

  // Size variants
  '& .card.sm': {
    minHeight: '120px',
  },
  
  '& .card.md': {
    minHeight: '160px',
  },
  
  '& .card.lg': {
    minHeight: '200px',
  },

  // Utility classes for the card HTML
  '& .mt-1': {
    marginTop: theme.spacing(1),
  },
  
  '& .p-1': {
    padding: theme.spacing(1),
  },
  
  '& .d-flex': {
    display: 'flex',
  },
  
  '& .flex-direction-column': {
    flexDirection: 'column',
  },
  
  '& .align-items-start': {
    alignItems: 'flex-start',
  },
  
  '& .justify-content-start': {
    justifyContent: 'flex-start',
  },
  
  '& .fw-500': {
    fontWeight: 500,
  },
  
  '& .fw-400': {
    fontWeight: 400,
  },
  
  '& .lh-2': {
    lineHeight: 1.3,
  },
  
  '& .text-gray-16': {
    color: theme.colors.text.primary,
  },
  
  '& .text-gray-12': {
    color: theme.colors.text.secondary,
  },
  
  '& .body-default': {
    fontSize: theme.typography.body.fontSize,
  },
  
  '& .body-small': {
    fontSize: theme.typography.bodySmall.fontSize,
  },

  // Grafana Play promotional component - Compact version
  '& .bg-gray-1': {
    backgroundColor: theme.colors.background.secondary,
  },

  '& .br-12': {
    borderRadius: '8px', // Reduced from 12px
  },

  '& .br-8': {
    borderRadius: '6px', // Reduced from 8px
  },

  '& .d-sm-flex': {
    display: 'flex',
    gap: theme.spacing(1.5), // Reduced from 2
    alignItems: 'center',
    
    '@media (max-width: 768px)': {
      flexDirection: 'column',
      textAlign: 'center',
      gap: theme.spacing(1),
    },
  },

  '& .flex-direction-row-reverse': {
    flexDirection: 'row-reverse',
    
    '@media (max-width: 768px)': {
      flexDirection: 'column',
    },
  },

  '& .p-2': {
    padding: theme.spacing(1.5), // Reduced from 2
  },

  '& .pt-0': {
    paddingTop: 0,
  },

  '& .pb-half': {
    paddingBottom: theme.spacing(0.25), // Reduced from 0.5
  },

  '& .pr-1': {
    paddingRight: theme.spacing(0.75), // Reduced from 1
  },

  '& .mb-1': {
    marginBottom: theme.spacing(0.75), // Reduced from 1
  },

  '& .mx-auto': {
    marginLeft: 'auto',
    marginRight: 'auto',
  },

  '& .h4': {
    fontSize: theme.typography.h5.fontSize, // Reduced from h4
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
    lineHeight: 1.2, // Tighter line height
  },

  '& .fw-600': {
    fontWeight: 600,
  },

  '& .w-175': {
    minWidth: '140px', // Reduced from 175px
  },

  // Grafana Play button styling - Compact version
  '& .btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.75), // Reduced from 1
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`, // Reduced from 1.5, 2.5
    border: 'none',
    borderRadius: theme.shape.radius.default,
    textDecoration: 'none',
    fontSize: theme.typography.bodySmall.fontSize, // Reduced from body
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
    padding: `${theme.spacing(1.25)} ${theme.spacing(2.5)}`, // Reduced from 2, 3
    fontSize: theme.typography.body.fontSize, // Reduced from h6
    minHeight: '36px', // Reduced from 48px
  },

  // Arrow styling for buttons - Compact version
  '& .btn.arrow': {
    position: 'relative',
    
    '&:after': {
      content: '"→"',
      marginLeft: theme.spacing(0.75), // Reduced from 1
      fontSize: '1.1em', // Reduced from 1.2em
      transition: 'transform 0.2s ease',
    },
    
    '&:hover:after': {
      transform: 'translateX(2px)',
    },
  },

  // Grafana Play image styling - Compact version
  '& .lazyload': {
    maxWidth: '160px', // Much smaller, was 100%
    height: 'auto',
    borderRadius: theme.shape.radius.default,
    
    '@media (max-width: 768px)': {
      maxWidth: '120px', // Reduced from 200px
      marginBottom: theme.spacing(1), // Reduced from 2
    },
  },
}); 
