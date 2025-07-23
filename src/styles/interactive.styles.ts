import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

// Export this for component-level, theme-aware styles if needed
export const getInteractiveStyles = (theme: GrafanaTheme2) => css({
  // Interactive sequence container
  '.interactive[data-targetaction="sequence"]': {
    display: 'block',
    padding: theme.spacing(2),
    margin: `${theme.spacing(2)} 0`,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    position: 'relative',

    // List items inside sequences
    'li.interactive': {
      paddingLeft: theme.spacing(2),
      paddingRight: theme.spacing(2),
      margin: `${theme.spacing(1)} 0`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: '40px',
      position: 'relative',
      '&::before': {
        content: '"•"',
        position: 'absolute',
        left: `-${theme.spacing(2)}`,
        top: '50%',
        transform: 'translateY(-50%)',
        color: theme.colors.text.secondary,
        fontSize: '14px',
        width: '16px',
        height: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      },
    },

    // Non-interactive list items
    'li:not(.interactive)': {
      margin: `${theme.spacing(1)} 0`,
      color: theme.colors.text.primary,
      paddingLeft: theme.spacing(2),
      paddingRight: theme.spacing(2),
      display: 'flex',
      alignItems: 'center',
      minHeight: '40px',
      position: 'relative',
      '&::before': {
        content: '"•"',
        position: 'absolute',
        left: `-${theme.spacing(2)}`,
        top: '50%',
        transform: 'translateY(-50%)',
        color: theme.colors.text.secondary,
        fontSize: '14px',
        width: '16px',
        height: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    },

    // Button in section
    '> button[onclick*="interactive-sequence"]': {
      marginTop: theme.spacing(2),
      display: 'block',
      width: 'fit-content',
    },

    // Button container inside sequence
    '.interactive-button-container': {
      marginTop: theme.spacing(2),
      marginLeft: 0,
      justifyContent: 'flex-start',
    },
  },

  // Base interactive element
  '.interactive': {
    position: 'relative',

    // Any interactive element except for sequence
    '&[data-targetaction]:not([data-targetaction="sequence"])': {
      paddingLeft: theme.spacing(2.5),
      paddingRight: theme.spacing(2),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: '40px',
      position: 'relative',
      '&::before': {
        content: '"•"',
        position: 'absolute',
        left: theme.spacing(0.5),
        top: '50%',
        transform: 'translateY(-50%)',
        color: theme.colors.text.secondary,
        fontSize: '14px',
        width: '16px',
        height: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      },
    },
  },

  // Button container for "show/do" etc.
  '.interactive-button-container': {
    display: 'flex',
    gap: theme.spacing(0.75),
    alignItems: 'center',
    flexShrink: 0,
  },

  // General interactive button
  '.interactive-button': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${theme.spacing(0.5)} ${theme.spacing(1.25)}`,
    border: `1px solid transparent`,
    borderRadius: theme.shape.radius.default,
    fontSize: '12px',
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: '1.3',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease-in-out',
    position: 'relative',
    minHeight: `${theme.spacing(3.5)}`,
    whiteSpace: 'nowrap',
    '&:disabled': {
      opacity: 0.65,
      cursor: 'not-allowed',
      pointerEvents: 'none',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: `0 0 0 2px ${theme.colors.primary.main}33`,
    },
    '&:active': {
      transform: 'translateY(0)',
      boxShadow: 'none',
    },
  },

  // "Show me" button
  '.interactive-show-button': {
    backgroundColor: theme.colors.secondary.main,
    color: theme.colors.secondary.contrastText,
    border: `1px solid ${theme.colors.secondary.border}`,
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.secondary.shade,
      borderColor: theme.colors.secondary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },
    '&:focus': {
      boxShadow: `0 0 0 2px ${theme.colors.secondary.main}33`,
    },
  },

  // "Do it" button
  '.interactive-do-button': {
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: `1px solid ${theme.colors.primary.border}`,
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.primary.shade,
      borderColor: theme.colors.primary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },
    '&:focus': {
      boxShadow: `0 0 0 2px ${theme.colors.primary.main}33`,
    },
  },

  // Section/sequence button
  '.interactive-sequence-button': {
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.75)}`,
    backgroundColor: theme.colors.background.primary,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    fontWeight: theme.typography.fontWeightMedium,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontSize: '11px',
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.strong,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },
    '&:focus': {
      boxShadow: `0 0 0 2px ${theme.colors.text.primary}33`,
    },
  },

  // Code block styles
  '.code-block': {
    margin: `${theme.spacing(2)} 0`,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  },

  '.code-block-header': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    backgroundColor: theme.colors.background.primary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    minHeight: theme.spacing(4),
  },

  '.code-block-language': {
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },

  '.code-block-copy-btn': {
    // IconButton from Grafana already has good base styles
    // Just ensure it's visible and positioned correctly
    opacity: 0.7,
    '&:hover': {
      opacity: 1,
    },
  },

  '.code-block-pre': {
    margin: 0,
    padding: theme.spacing(2),
    overflow: 'auto',
    backgroundColor: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
    fontFamily: theme.typography.fontFamilyMonospace,

    'code': {
      backgroundColor: 'transparent',
      padding: 0,
      fontSize: 'inherit',
      fontFamily: 'inherit',
      color: theme.colors.text.primary,
    },
  },

  // Inline code styles
  '.inline-code': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    backgroundColor: theme.colors.background.secondary,
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontFamily: theme.typography.fontFamilyMonospace,
    border: `1px solid ${theme.colors.border.weak}`,

    'code': {
      backgroundColor: 'transparent',
      padding: 0,
      fontSize: 'inherit',
      fontFamily: 'inherit',
      color: theme.colors.text.primary,
    },
  },

'.inline-copy-btn': {
  // Let Grafana IconButton handle all the styling
  '& button': {
    minWidth: '20px !important',
    minHeight: '20px !important',
    padding: '2px !important',
  }
},

  // Interactive Section styles
  '.interactive-section': {
    margin: `${theme.spacing(3)} 0`,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.primary,
    overflow: 'hidden',
    '&.completed': {
      borderColor: theme.colors.success.border,
      backgroundColor: theme.colors.success.transparent,
    },
  },

  '.interactive-section-header': {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: `${theme.spacing(1.5)} ${theme.spacing(2)}`,
    backgroundColor: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  },

  '.interactive-section-toggle': {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: 0,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    flex: 1,
    textAlign: 'left',
    '&:hover': {
      color: theme.colors.primary.main,
    },
    '&:disabled': {
      opacity: 0.6,
      cursor: 'not-allowed',
    },
  },

  '.interactive-section-icon': {
    fontSize: '12px',
    color: theme.colors.text.secondary,
    minWidth: '12px',
    textAlign: 'center',
  },

  '.interactive-section-title': {
    margin: 0,
    fontSize: 'inherit',
    fontWeight: 'inherit',
  },

  '.interactive-section-checkmark': {
    color: theme.colors.success.main,
    fontSize: '14px',
    fontWeight: 'bold',
  },

  '.interactive-section-hint': {
    color: theme.colors.text.secondary,
    fontSize: '14px',
    cursor: 'help',
    '&:hover': {
      color: theme.colors.text.primary,
    },
  },

  '.interactive-section-description': {
    padding: `0 ${theme.spacing(2)} ${theme.spacing(1.5)}`,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  },

  '.interactive-section-content': {
    padding: theme.spacing(2),
  },

  // Interactive Step styles
  '.interactive-step': {
    margin: `${theme.spacing(2)} 0`,
    padding: theme.spacing(2),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.primary,
    '&.completed': {
      borderColor: theme.colors.success.border,
      backgroundColor: theme.colors.success.transparent,
    },
  },

  '.interactive-step-content': {
    marginBottom: theme.spacing(1.5),
  },

  '.interactive-step-title': {
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(0.5),
  },

  '.interactive-step-description': {
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(1),
  },

  '.interactive-step-actions': {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },

  '.interactive-step-action-btn': {
    // Button from Grafana UI already has good base styles
    minWidth: '120px',
  },

  '.interactive-step-completed-indicator': {
    color: theme.colors.success.main,
    fontSize: '16px',
    fontWeight: 'bold',
  },

  // Expandable Table styles
  '.expandable-table': {
    margin: `${theme.spacing(2)} 0`,
  },

  '.expandable-table-toggle-btn': {
    marginBottom: theme.spacing(1),
  },

  '.expandable-table-content': {
    overflow: 'hidden',
    transition: 'max-height 0.3s ease-in-out',
    '&.collapsed': {
      maxHeight: 0,
    },
    '&:not(.collapsed)': {
      maxHeight: 'none',
    },
    
    // Style tables inside expandable content
    'table': {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: theme.typography.bodySmall.fontSize,
      'th, td': {
        padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
        textAlign: 'left',
        borderBottom: `1px solid ${theme.colors.border.weak}`,
      },
      'th': {
        fontWeight: theme.typography.fontWeightMedium,
        backgroundColor: theme.colors.background.secondary,
        color: theme.colors.text.primary,
      },
      'td': {
        color: theme.colors.text.primary,
      },
      'tr:hover': {
        backgroundColor: theme.colors.action.hover,
      },
    },
  },
});


// Pure global (vanilla) CSS for overlays/highlights—run once at app startup
export const addGlobalInteractiveStyles = () => {
  const interactiveStyleId = 'interactive-global-styles';
  if (document.getElementById(interactiveStyleId)) {
    return;
  }
  const style = document.createElement('style');
  style.id = interactiveStyleId;
  style.textContent = `
    /* Global interactive highlight styles */
    .interactive-highlighted {
      position: relative;
      z-index: 1;
    }
    .interactive-highlight-outline {
      position: absolute;
      top: var(--highlight-top);
      left: var(--highlight-left);
      width: var(--highlight-width);
      height: var(--highlight-height);
      border: 2px solid var(--grafana-warning-main, #FF8800);
      border-radius: 4px;
      pointer-events: none;
      z-index: 9999;
      background-color: var(--grafana-warning-transparent, rgba(255, 136, 0, 0.1));
      box-shadow: 0 0 0 4px var(--grafana-warning-transparent-medium, rgba(255, 136, 0, 0.2));
      animation: highlight-pulse 2s ease-in-out forwards;
    }
    @keyframes highlight-pulse {
      0% {
        opacity: 0;
        transform: scale(0.95);
        box-shadow: 0 0 0 0 var(--grafana-warning-transparent-strong, rgba(255, 136, 0, 0.4));
      }
      25% {
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 8px var(--grafana-warning-transparent-medium, rgba(255, 136, 0, 0.3));
      }
      50% {
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 12px var(--grafana-warning-transparent, rgba(255, 136, 0, 0.2));
      }
      75% {
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 8px var(--grafana-warning-transparent-weak, rgba(255, 136, 0, 0.1));
      }
      100% {
        opacity: 0;
        transform: scale(0.95);
        box-shadow: 0 0 0 0 transparent;
      }
    }
  `;
  document.head.appendChild(style);
};
