import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';

// Base interactive element styles
const getBaseInteractiveStyles = (theme: GrafanaTheme2) => ({
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
  '.tab-content': {
    '& > div > pre': {
      marginTop: 0,
    },
    '& > div > div': {
      padding: theme.spacing(2),
    },
  },
});

// Button styles (shared across different interactive elements)
const getInteractiveButtonStyles = (theme: GrafanaTheme2) => ({
  // General interactive button base
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
});

// Interactive sequence specific styles
const getInteractiveSequenceStyles = (theme: GrafanaTheme2) => ({
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
});

// Code block styles (can be shared with content styles)
const getCodeBlockStyles = (theme: GrafanaTheme2) => ({
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

    code: {
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

    code: {
      backgroundColor: 'transparent',
      padding: 0,
      fontSize: 'inherit',
      fontFamily: 'inherit',
      color: theme.colors.text.primary,
    },
  },

  '.inline-copy-btn': {
    '& button': {
      minWidth: '20px !important',
      minHeight: '20px !important',
      padding: '2px !important',
    },
  },
});

// Interactive component styles (sections and steps)
const getInteractiveComponentStyles = (theme: GrafanaTheme2) => ({
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
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: `${theme.spacing(1.5)} ${theme.spacing(2)}`,
    backgroundColor: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  },

  '.interactive-section-title-container': {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flex: 1,
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
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    flex: 1,
  },

  '.interactive-section-checkmark': {
    color: theme.colors.success.main,
    fontSize: '16px',
    fontWeight: 'bold',
    marginLeft: theme.spacing(1),
  },

  '.interactive-section-spinner': {
    color: theme.colors.warning.main,
    fontSize: '16px',
    fontWeight: 'bold',
    marginLeft: theme.spacing(1),
    animation: 'spin 1s linear infinite',
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

    // Step status styles
    '& .step-status-pending': {
      opacity: 0.7,
    },

    '& .step-status-running': {
      borderColor: theme.colors.warning.border,
      backgroundColor: theme.colors.warning.transparent,
      transform: 'scale(1.02)',
      transition: 'all 0.3s ease',
    },

    '& .step-status-completed': {
      borderColor: theme.colors.success.border,
      backgroundColor: theme.colors.success.transparent,
      opacity: 0.8,
    },
  },

  '.interactive-section-actions': {
    padding: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.canvas,
    display: 'flex',
    justifyContent: 'center',
  },

  '.interactive-section-do-button': {
    minWidth: '200px',
    fontWeight: theme.typography.fontWeightMedium,

    '&:disabled': {
      opacity: 0.6,
      cursor: 'not-allowed',
    },
  },

  // Interactive Step styles
  '.interactive-step': {
    margin: `${theme.spacing(2)} 0`,
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.primary,
    '&.completed': {
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
    flexDirection: 'column',
    gap: theme.spacing(1),
  },

  '.interactive-step-action-buttons': {
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
  },

  '.interactive-step-show-btn': {
    minWidth: '80px',
    fontSize: theme.typography.bodySmall.fontSize,
  },

  '.interactive-step-do-btn': {
    minWidth: '80px',
    fontSize: theme.typography.bodySmall.fontSize,
  },

  '.interactive-step-description-text': {
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    textAlign: 'center',
    padding: `${theme.spacing(0.5)} 0`,
  },

  '.interactive-step-action-btn': {
    minWidth: '120px',
  },

  '.interactive-step-completed-indicator': {
    color: theme.colors.success.main,
    fontSize: '16px',
    fontWeight: 'bold',
  },

  '.interactive-step-completion-group': {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  },

  '.interactive-step-redo-btn': {
    padding: '2px 6px',
    fontSize: '0.75rem',
    border: `1px solid ${theme.colors.border.medium}`,
    background: 'transparent',
    color: theme.colors.text.secondary,
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    minHeight: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.strong,
      color: theme.colors.text.primary,
    },
    '&:active': {
      transform: 'scale(0.95)',
    },
  },

  // Requirement explanation styles
  '.interactive-step-requirement-explanation': {
    color: theme.colors.text.secondary,
    fontSize: '0.875rem',
    marginTop: '8px',
    fontStyle: 'italic',
    lineHeight: '1.4',
    paddingLeft: '12px',
  },

  '.interactive-requirement-retry-btn': {
    marginLeft: '8px',
    padding: '2px 8px',
    fontSize: '0.75rem',
    border: `1px solid ${theme.colors.border.medium}`,
    background: 'transparent',
    color: theme.colors.text.secondary,
    borderRadius: '4px',
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.strong,
      color: theme.colors.text.primary,
    },
  },

  // Execution error styles
  '.interactive-step-execution-error': {
    color: '#dc3545',
    fontSize: '0.875rem',
    marginTop: '8px',
    fontStyle: 'italic',
    lineHeight: '1.4',
    paddingLeft: '12px',
  },

  '.interactive-error-retry-btn': {
    marginLeft: '8px',
    padding: '2px 8px',
    fontSize: '0.75rem',
    border: '1px solid #dc3545',
    background: 'transparent',
    color: '#dc3545',
    borderRadius: '4px',
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: 'rgba(220, 53, 69, 0.1)',
    },
  },
});

// Comment box styles are now handled in global styles to avoid theme override conflicts

// Expandable components styles
const getExpandableStyles = (theme: GrafanaTheme2) => ({
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
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: theme.typography.bodySmall.fontSize,
      'th, td': {
        padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
        textAlign: 'left',
        borderBottom: `1px solid ${theme.colors.border.weak}`,
      },
      th: {
        fontWeight: theme.typography.fontWeightMedium,
        backgroundColor: theme.colors.background.secondary,
        color: theme.colors.text.primary,
      },
      td: {
        color: theme.colors.text.primary,
      },
      'tr:hover': {
        backgroundColor: theme.colors.action.hover,
      },
    },
  },
});

// Export this for component-level, theme-aware styles if needed
export const getInteractiveStyles = (theme: GrafanaTheme2) =>
  css({
    ...getBaseInteractiveStyles(theme),
    ...getInteractiveButtonStyles(theme),
    ...getInteractiveSequenceStyles(theme),
    ...getCodeBlockStyles(theme),
    ...getInteractiveComponentStyles(theme),
    ...getExpandableStyles(theme),
  } as any);

// Pure global (vanilla) CSS for overlays/highlights—run once at app startup
export const addGlobalInteractiveStyles = () => {
  const interactiveStyleId = 'interactive-global-styles';
  if (document.getElementById(interactiveStyleId)) {
    return;
  }
  const style = document.createElement('style');
  style.id = interactiveStyleId;
  // Align highlight animation timing with configured technical highlight delay
  const highlightMs = INTERACTIVE_CONFIG.delays.technical.highlight;
  // Slower, more readable draw; short hold; erase the remainder
  const drawMs = Math.max(500, Math.round(highlightMs * 0.65));
  const holdMs = Math.max(120, Math.round(highlightMs * 0.2));
  const eraseMs = Math.max(250, Math.max(0, highlightMs - drawMs - holdMs));
  const fadeDelay = drawMs + holdMs; // ensure fade starts after draw completes + hold
  style.textContent = `
    /* Blocker overlay visuals (used by GlobalInteractionBlocker) */
    #interactive-blocking-overlay {
      background: transparent !important;
      /* Always-visible subtle border */
      border: 1px solid rgba(170, 170, 170, 0.35);
      /* Breathing pulse layered on top */
      box-shadow: inset 0 0 0 0 rgba(170, 170, 170, 0.22);
      animation: blocker-breathe 3.2s ease-in-out infinite;
    }

    /* When a modal is active, remove breathing pulse to avoid visual clash and keep overlay subtle */
    #interactive-blocking-overlay.no-breathe {
      animation: none !important;
      box-shadow: none !important;
      border: none !important;
    }

    /* Full-screen overlay for modal blocking */
    #interactive-fullscreen-overlay {
      background: transparent !important;
      /* Gray pulse around the outside edge - more visible for full screen */
      border: 2px solid rgba(170, 170, 170, 0.4);
      box-shadow: inset 0 0 0 0 rgba(170, 170, 170, 0.3);
      animation: fullscreen-breathe 2.8s ease-in-out infinite;
    }

    /* Header overlay styling */
    #interactive-header-overlay {
      background: transparent !important;
      border: 1px solid rgba(170, 170, 170, 0.35);
      box-shadow: inset 0 0 0 0 rgba(170, 170, 170, 0.22);
      animation: blocker-breathe 3.2s ease-in-out infinite;
    }

    @keyframes blocker-breathe {
      0% {
        box-shadow: inset 0 0 0 0 rgba(170, 170, 170, 0.18);
      }
      50% {
        box-shadow: inset 0 0 0 6px rgba(170, 170, 170, 0.20);
      }
      100% {
        box-shadow: inset 0 0 0 0 rgba(170, 170, 170, 0.18);
      }
    }

    @keyframes fullscreen-breathe {
      0% {
        box-shadow: inset 0 0 0 0 rgba(170, 170, 170, 0.25);
        border-color: rgba(170, 170, 170, 0.35);
      }
      50% {
        box-shadow: inset 0 0 0 8px rgba(170, 170, 170, 0.30);
        border-color: rgba(170, 170, 170, 0.45);
      }
      100% {
        box-shadow: inset 0 0 0 0 rgba(170, 170, 170, 0.25);
        border-color: rgba(170, 170, 170, 0.35);
      }
    }
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
      pointer-events: none;
      z-index: 9999;
      border-radius: 4px;
      /* Draw border clockwise using four gradient strokes (no fill) */
      --hl-color: rgba(255, 136, 0, 0.85);
      --hl-thickness: 2px;
      background:
        linear-gradient(var(--hl-color) 0 0) top left / 0 var(--hl-thickness) no-repeat,
        linear-gradient(var(--hl-color) 0 0) top right / var(--hl-thickness) 0 no-repeat,
        linear-gradient(var(--hl-color) 0 0) bottom right / 0 var(--hl-thickness) no-repeat,
        linear-gradient(var(--hl-color) 0 0) bottom left / var(--hl-thickness) 0 no-repeat;
      opacity: 0.95;
      /* Draw, brief hold, graceful fade — aligned to config highlight delay */
      animation-name: interactive-draw-border, interactive-fade-out;
      animation-duration: ${drawMs}ms, ${eraseMs}ms;
      animation-timing-function: cubic-bezier(0.18, 0.6, 0.2, 1), cubic-bezier(0.4, 0.0, 0.2, 1);
      animation-delay: 0ms, ${fadeDelay}ms; /* start fade only after draw + hold */
      animation-fill-mode: forwards, forwards;
    }
    /* Subtle variant to reuse animation cadence for blocked areas */
    .interactive-highlight-outline--subtle {
      border-color: rgba(180, 180, 180, 0.4);
      background-color: rgba(180, 180, 180, 0.08);
      box-shadow: 0 0 0 4px rgba(180, 180, 180, 0.12);
      animation: subtle-highlight-pulse 1.6s ease-in-out infinite;
    }




    @keyframes interactive-draw-border {
      0% {
        background-size: 0 var(--hl-thickness), var(--hl-thickness) 0, 0 var(--hl-thickness), var(--hl-thickness) 0;
      }
      25% {
        background-size: 100% var(--hl-thickness), var(--hl-thickness) 0, 0 var(--hl-thickness), var(--hl-thickness) 0;
      }
      50% {
        background-size: 100% var(--hl-thickness), var(--hl-thickness) 100%, 0 var(--hl-thickness), var(--hl-thickness) 0;
      }
      75% {
        background-size: 100% var(--hl-thickness), var(--hl-thickness) 100%, 100% var(--hl-thickness), var(--hl-thickness) 0;
      }
      100% {
        background-size: 100% var(--hl-thickness), var(--hl-thickness) 100%, 100% var(--hl-thickness), var(--hl-thickness) 100%;
      }
    }

    /* Graceful fade out without undrawing the stroke */
    @keyframes interactive-fade-out {
      0% { opacity: 0.95; }
      100% { opacity: 0; }
    }

    /* Enhanced comment box animations */
    @keyframes fadeInComment {
      0% {
        opacity: 0;
        transform: scale(0.85) translateY(-8px);
      }
      60% {
        transform: scale(1.02) translateY(0);
      }
      100% {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    /* Comment box exit animation */
    .comment-box-exit {
      animation: fadeOutComment 0.2s ease-in forwards !important;
    }

    @keyframes fadeOutComment {
      0% {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
      100% {
        opacity: 0;
        transform: scale(0.9) translateY(-5px);
      }
    }

    @keyframes subtle-highlight-pulse {
      0% {
        opacity: 0.55;
        transform: scale(0.995);
        box-shadow: 0 0 0 0 rgba(180, 180, 180, 0.12);
      }
      50% {
        opacity: 0.8;
        transform: scale(1);
        box-shadow: 0 0 0 6px rgba(180, 180, 180, 0.16);
      }
      100% {
        opacity: 0.55;
        transform: scale(0.995);
        box-shadow: 0 0 0 0 rgba(180, 180, 180, 0.12);
      }
    }

    /* Fragment highlighting for anchor navigation */
    .fragment-highlight {
      position: relative;
      background-color: rgba(255, 193, 7, 0.2) !important;
      border-left: 4px solid #ffc107 !important;
      padding-left: 8px !important;
      margin-left: -12px !important;
      animation: fragment-highlight-fade 3s ease-out forwards;
    }

    @keyframes fragment-highlight-fade {
      0% {
        background-color: rgba(255, 193, 7, 0.4);
        border-left-color: #ffc107;
      }
      50% {
        background-color: rgba(255, 193, 7, 0.3);
        border-left-color: #ffc107;
      }
      100% {
        background-color: rgba(255, 193, 7, 0.1);
        border-left-color: transparent;
      }
    }

    /* Interactive comment box - positioning only (no theme colors) */
    .interactive-comment-box {
      position: absolute;
      top: var(--comment-top);
      left: var(--comment-left);
      max-width: 250px;
      min-width: 200px;
      pointer-events: none;
      z-index: 10002;
      animation: fadeInComment 0.3s ease-out;
    }

    .interactive-comment-content {
      border-radius: 6px;
      padding: 12px;
      font-size: 13px;
      line-height: 1.4;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      position: relative;
      /* Essential styling that needs to be global to avoid theme override conflicts */
      background: var(--grafana-colors-background-primary, #1f1f23);
      border: 1px solid var(--grafana-colors-border-medium, #404040);
      color: var(--grafana-colors-text-primary, #d9d9d9);
      /* Ensure content fits within container bounds */
      overflow: hidden;
      word-wrap: break-word;
      overflow-wrap: break-word;
      max-width: 100%;
      box-sizing: border-box;
    }

    /* Orange glow border for comment boxes */
    .interactive-comment-glow {
      border: 2px solid rgba(255, 136, 0, 0.5) !important;
      box-shadow:
        0 4px 12px rgba(0, 0, 0, 0.15),
        0 0 0 3px rgba(255, 136, 0, 0.6),
        0 0 15px rgba(255, 136, 0, 0.4),
        0 0 25px rgba(255, 136, 0, 0.2) !important;
    }

    /* Logo and text layout */
    .interactive-comment-wrapper {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .interactive-comment-logo {
      flex-shrink: 0;
      margin-top: 1px; /* Slight adjustment to align with text */
      width: 20px;
      height: 20px;
      overflow: hidden;
      border-radius: 4px;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .interactive-comment-logo img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: transparent;
      border-radius: 4px;
    }

    .interactive-comment-text {
      flex: 1;
      line-height: 1.4;
      word-wrap: break-word;
      overflow-wrap: break-word;
      max-width: 100%;
    }

    /* Handle code elements within comments */
    .interactive-comment-text code {
      display: inline-block;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 3px;
      padding: 1px 4px;
      font-size: 0.85em;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      word-break: break-all;
      white-space: pre-wrap;
      max-width: 100%;
      box-sizing: border-box;
    }

    /* Handle other inline elements to prevent overflow */
    .interactive-comment-text strong,
    .interactive-comment-text em,
    .interactive-comment-text span {
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .interactive-comment-arrow {
      position: absolute;
      width: 0;
      height: 0;
    }

    /* Arrow positioning and colors */
    .interactive-comment-box[style*="--comment-arrow-position: left"] .interactive-comment-arrow {
      top: 50%;
      left: -8px;
      transform: translateY(-50%);
      border-top: 8px solid transparent;
      border-bottom: 8px solid transparent;
      border-right: 8px solid var(--grafana-colors-background-primary, #1f1f23);
    }

    .interactive-comment-box[style*="--comment-arrow-position: right"] .interactive-comment-arrow {
      top: 50%;
      right: -8px;
      transform: translateY(-50%);
      border-top: 8px solid transparent;
      border-bottom: 8px solid transparent;
      border-left: 8px solid var(--grafana-colors-background-primary, #1f1f23);
    }

    .interactive-comment-box[style*="--comment-arrow-position: bottom"] .interactive-comment-arrow {
      bottom: -8px;
      left: 50%;
      transform: translateX(-50%);
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-top: 8px solid var(--grafana-colors-background-primary, #1f1f23);
    }

    /* Hide interactive comment spans - they're extracted as metadata */
    span.interactive-comment {
      display: none !important;
    }

    /* Spinner animation for section running state */
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
};
