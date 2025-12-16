import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { INTERACTIVE_Z_INDEX } from '../constants/interactive-z-index';

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
    '.code-block-language': {
      display: 'none',
    },
    '& > div > div': {
      padding: theme.spacing(2),
    },
    '& > div > .code-block': {
      padding: 0,
      marginTop: 0,
      marginLeft: 0,
      marginRight: 0,
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

    // Common styles for all list items
    li: {
      paddingLeft: theme.spacing(2),
      paddingRight: theme.spacing(2),
      margin: `${theme.spacing(1)} 0`,
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
        flexShrink: 0,
      },
    },

    // Interactive-specific overrides
    'li.interactive': {
      justifyContent: 'space-between',
    },

    // Non-interactive specific overrides
    'li:not(.interactive)': {
      color: theme.colors.text.primary,
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
    transition: 'all 0.3s ease',
    '&.completed': {
      borderColor: theme.colors.success.border,
      backgroundColor: theme.colors.success.transparent,
    },
    '&.collapsed': {
      marginBottom: theme.spacing(2),
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
    transition: 'border-bottom 0.3s ease',
    '&.collapsed': {
      borderBottom: 'none',
    },
  },

  '.interactive-section-toggle-button': {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.colors.text.secondary,
    fontSize: '14px',
    lineHeight: 1,
    transition: 'color 0.2s ease, transform 0.2s ease',
    minWidth: '24px',
    minHeight: '24px',
    flexShrink: 0,
    '&:hover': {
      color: theme.colors.text.primary,
      backgroundColor: theme.colors.action.hover,
    },
    '&:focus': {
      outline: `2px solid ${theme.colors.primary.main}`,
      outlineOffset: '2px',
    },
    '&:active': {
      backgroundColor: theme.colors.action.selected,
    },
  },

  '.interactive-section-toggle-icon': {
    display: 'block',
    transition: 'transform 0.2s ease',
    pointerEvents: 'none', // Ensure clicks go through to button
    fontSize: '14px',
    lineHeight: 1,
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
    opacity: 1,
    maxHeight: '10000px',
    overflow: 'hidden',
    transition: 'opacity 0.3s ease, max-height 0.3s ease',
    margin: 0,
    listStyle: 'none', // Hide default markers since we use CSS counters
    counterReset: 'step-counter', // Initialize counter

    // Increment counter for each step
    '& > .interactive-step, & > .interactive-multistep, & > .interactive-guided': {
      counterIncrement: 'step-counter',
      position: 'relative',
      paddingLeft: theme.spacing(4), // Space for the number

      // Add the step number using ::before pseudo-element
      '&::before': {
        content: 'counter(step-counter) "."',
        position: 'absolute',
        left: 0,
        top: theme.spacing(2), // Align with step content padding
        color: theme.colors.text.secondary,
        fontWeight: theme.typography.fontWeightMedium,
        fontSize: theme.typography.body.fontSize,
        width: theme.spacing(3),
        textAlign: 'right',
      },
    },

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

  '.interactive-section-requirement-explanation': {
    color: theme.colors.text.secondary,
    fontSize: '0.875rem',
    margin: `${theme.spacing(2)} ${theme.spacing(2)} 0`,
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.warning.transparent,
    border: `1px solid ${theme.colors.warning.border}`,
    borderRadius: theme.shape.radius.default,
    fontStyle: 'italic',
    lineHeight: '1.4',
  },

  '.interactive-section-actions': {
    padding: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.canvas,
    display: 'flex',
    justifyContent: 'center',
    transition: 'padding 0.3s ease',
    '&.collapsed': {
      padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
      justifyContent: 'flex-end',
    },
  },

  '.interactive-section-do-button': {
    minWidth: '200px',
    fontWeight: theme.typography.fontWeightMedium,

    '&:disabled': {
      opacity: 0.6,
      cursor: 'not-allowed',
    },
  },

  '.interactive-section-reset-button': {
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
    borderRadius: '8px',
    border: '2px solid transparent',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    '&.completed': {
      backgroundColor: theme.colors.success.transparent,
    },
    '&.skipped': {
      backgroundColor: theme.colors.info.transparent,
    },
    '&.executing': {
      borderColor: theme.colors.success.main,
      boxShadow: `0 0 0 1px ${theme.colors.success.transparent}, 0 0 12px ${theme.colors.success.transparent}`,
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

    // Skipped state - blue instead of green
    '&.skipped': {
      color: theme.colors.info.main,
    },
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

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUIREMENT/INFO STYLES - Subtle box for sequential step messaging
  // ═══════════════════════════════════════════════════════════════════════════

  '.interactive-step-requirement-explanation': {
    marginTop: '12px',
    padding: '10px 12px',
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '6px',
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: theme.colors.text.secondary,
    position: 'relative',
    // Add footprints icon via ::before with inline layout
    '&::before': {
      content: '"👣"',
      marginRight: '8px',
      fontSize: '0.9rem',
    },
    '&.rechecking': {
      opacity: 0.85,
    },
  },

  '.interactive-requirement-spinner': {
    position: 'absolute',
    top: '8px',
    right: '8px',
    fontSize: '0.85rem',
    color: theme.colors.text.secondary,
    animation: 'spin 1s linear infinite',
  },

  '@keyframes spin': {
    from: { transform: 'rotate(0deg)' },
    to: { transform: 'rotate(360deg)' },
  },

  '.interactive-step-requirement-buttons': {
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
    width: '100%',
  },

  '.interactive-requirement-retry-btn': {
    padding: '4px 10px',
    fontSize: '0.8rem',
    fontWeight: 500,
    border: `1px solid ${theme.colors.border.medium}`,
    background: 'transparent',
    color: theme.colors.text.secondary,
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.strong,
      color: theme.colors.text.primary,
    },
  },

  '.interactive-requirement-skip-btn': {
    padding: '4px 10px',
    fontSize: '0.8rem',
    fontWeight: 500,
    border: `1px solid ${theme.colors.border.medium}`,
    background: 'transparent',
    color: theme.colors.text.secondary,
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.strong,
      color: theme.colors.text.primary,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION ERROR STYLES - Warning amber (not critical)
  // ═══════════════════════════════════════════════════════════════════════════

  '.interactive-step-execution-error': {
    marginTop: '12px',
    padding: '10px 12px',
    background: theme.colors.warning.transparent,
    border: `1px solid ${theme.colors.warning.border}`,
    borderRadius: '6px',
    fontSize: '0.875rem',
    lineHeight: '1.4',
    color: theme.colors.warning.text,
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    flexWrap: 'wrap',
    // Add warning icon via ::before
    '&::before': {
      content: '"⚠"',
      fontSize: '1rem',
      flexShrink: 0,
    },
  },

  '.interactive-step-error-buttons': {
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(0.5),
    width: '100%',
  },

  '.interactive-error-retry-btn': {
    padding: '4px 10px',
    fontSize: '0.8rem',
    fontWeight: 500,
    border: `1px solid ${theme.colors.warning.border}`,
    background: 'transparent',
    color: theme.colors.warning.text,
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
      background: theme.colors.warning.main,
      color: theme.colors.warning.contrastText,
      borderColor: theme.colors.warning.main,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM VALIDATION STYLES - Checking indicator and validation hint warning
  // ═══════════════════════════════════════════════════════════════════════════

  // Form checking indicator (shown during 2s debounce)
  '.interactive-step-form-checking': {
    marginTop: '12px',
    padding: '10px 12px',
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '6px',
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: theme.colors.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  '.interactive-form-spinner': {
    fontSize: '0.9rem',
    color: theme.colors.text.secondary,
    animation: 'spin 1s linear infinite',
  },

  '.interactive-form-checking-text': {
    color: theme.colors.text.secondary,
  },

  // Form validation hint warning (shown when regex pattern doesn't match)
  '.interactive-step-form-hint-warning': {
    marginTop: '12px',
    padding: '10px 12px',
    background: theme.colors.warning.transparent,
    border: `1px solid ${theme.colors.warning.border}`,
    borderRadius: '6px',
    fontSize: '0.875rem',
    lineHeight: '1.4',
    color: theme.colors.warning.text,
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },

  '.interactive-form-warning-icon': {
    fontSize: '1rem',
    flexShrink: 0,
    color: theme.colors.warning.main,
  },

  '.interactive-form-hint-text': {
    flex: 1,
    wordWrap: 'break-word' as const,
    overflowWrap: 'break-word' as const,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GUIDED INTERACTION STYLES - Redesigned with clear state-based UI
  // ═══════════════════════════════════════════════════════════════════════════

  // Base guided container with state modifier
  '.interactive-guided': {
    position: 'relative',
  },

  // ─── IDLE STATE ───────────────────────────────────────────────────────────
  '.interactive-guided-idle': {
    marginTop: '12px',
  },

  '.interactive-guided-actions': {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },

  '.interactive-guided-start-btn': {
    fontWeight: 500,
  },

  // ─── CHECKING STATE ───────────────────────────────────────────────────────
  '.interactive-guided-checking': {
    marginTop: '12px',
  },

  '.interactive-guided-status': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: theme.colors.text.secondary,
    fontSize: '0.875rem',
  },

  '.interactive-guided-spinner': {
    width: '14px',
    height: '14px',
    border: `2px solid ${theme.colors.border.weak}`,
    borderTopColor: theme.colors.primary.main,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },

  // ─── REQUIREMENTS NOT MET STATE (subtle - part of normal flow) ────────────
  '.interactive-guided-requirements': {
    marginTop: '12px',
    '&.rechecking': {
      opacity: 0.85,
    },
  },

  '.interactive-guided-requirement-box': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '10px 12px',
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '6px',
    marginBottom: '10px',
    position: 'relative',
  },

  '.interactive-guided-requirement-icon': {
    color: theme.colors.text.secondary,
    fontSize: '1rem',
    lineHeight: 1.4,
    flexShrink: 0,
  },

  '.interactive-guided-requirement-text': {
    color: theme.colors.text.secondary,
    fontSize: '0.875rem',
    lineHeight: 1.4,
  },

  '.interactive-guided-fix-btn': {
    padding: '6px 12px',
    fontSize: '0.8rem',
    fontWeight: 500,
    border: `1px solid ${theme.colors.border.medium}`,
    background: 'transparent',
    color: theme.colors.text.secondary,
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
      background: theme.colors.action.hover,
      color: theme.colors.text.primary,
      borderColor: theme.colors.border.strong,
    },
  },

  // ─── EXECUTING STATE ──────────────────────────────────────────────────────
  '.interactive-guided-executing': {
    marginTop: '12px',
    padding: '12px 0',
  },

  '.interactive-guided-step-indicator': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },

  '.interactive-guided-step-badge': {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    background: theme.colors.text.secondary,
    color: theme.colors.background.primary,
    borderRadius: '10px',
    fontSize: '0.7rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    opacity: 0.9,
  },

  '.interactive-guided-step-done': {
    color: theme.colors.success.main,
    fontSize: '0.9rem',
  },

  '.interactive-guided-instruction': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '14px',
    paddingLeft: '2px',
  },

  '.interactive-guided-instruction-icon': {
    fontSize: '1rem',
    lineHeight: 1.5,
    flexShrink: 0,
  },

  '.interactive-guided-instruction-text': {
    color: theme.colors.text.primary,
    fontSize: '0.875rem',
    lineHeight: 1.5,
    '& strong': {
      fontWeight: 600,
      color: theme.colors.text.maxContrast,
    },
  },

  '.interactive-guided-progress': {
    position: 'relative',
    height: '3px',
    background: theme.colors.border.weak,
    borderRadius: '2px',
    marginBottom: '14px',
    overflow: 'hidden',
  },

  '.interactive-guided-progress-fill': {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    background: theme.colors.success.shade,
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },

  '.interactive-guided-progress-active': {
    position: 'absolute',
    top: 0,
    height: '100%',
    background: `linear-gradient(90deg, ${theme.colors.primary.main} 0%, ${theme.colors.primary.shade} 100%)`,
    borderRadius: '2px',
    animation: 'progressPulse 1.2s ease-in-out infinite',
  },

  '.interactive-guided-cancel-btn': {
    opacity: 0.7,
    fontSize: '0.8rem',
    '&:hover': {
      opacity: 1,
    },
  },

  // ─── ERROR/TIMEOUT STATE (uses warning colors - not critical) ─────────────
  '.interactive-guided-error': {
    marginTop: '12px',
  },

  '.interactive-guided-error-box': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '12px 14px',
    background: theme.colors.warning.transparent,
    border: `1px solid ${theme.colors.warning.border}`,
    borderRadius: '6px',
    marginBottom: '12px',
  },

  '.interactive-guided-error-icon': {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: theme.colors.warning.main,
    color: theme.colors.warning.contrastText,
    borderRadius: '50%',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    flexShrink: 0,
  },

  '.interactive-guided-error-content': {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },

  '.interactive-guided-error-title': {
    color: theme.colors.warning.text,
    fontSize: '0.9rem',
    fontWeight: 600,
  },

  '.interactive-guided-error-detail': {
    color: theme.colors.text.secondary,
    fontSize: '0.8rem',
  },

  '.interactive-guided-error-actions': {
    display: 'flex',
    gap: '8px',
  },

  '.interactive-guided-retry-btn': {
    fontWeight: 500,
  },

  // ─── CANCELLED STATE ──────────────────────────────────────────────────────
  '.interactive-guided-cancelled': {
    marginTop: '12px',
  },

  '.interactive-guided-cancelled-box': {
    padding: '10px 14px',
    background: theme.colors.secondary.transparent,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '6px',
    marginBottom: '12px',
  },

  '.interactive-guided-cancelled-text': {
    color: theme.colors.text.secondary,
    fontSize: '0.875rem',
  },

  '.interactive-guided-cancelled-actions': {
    display: 'flex',
    gap: '8px',
  },

  // ─── COMPLETED STATE ──────────────────────────────────────────────────────
  '.interactive-guided-completed': {
    marginTop: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },

  '.interactive-guided-completed-badge': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    background: theme.colors.success.transparent,
    border: `1px solid ${theme.colors.success.border}`,
    borderRadius: '16px',
  },

  '.interactive-guided-completed-icon': {
    color: theme.colors.success.main,
    fontSize: '1rem',
    fontWeight: 'bold',

    '&.skipped': {
      color: theme.colors.text.secondary,
    },
  },

  '.interactive-guided-completed-text': {
    color: theme.colors.success.text,
    fontSize: '0.875rem',
    fontWeight: 500,
  },

  '.interactive-guided-completed-badge:has(.skipped) .interactive-guided-completed-text': {
    color: theme.colors.text.secondary,
  },

  '.interactive-guided-redo-btn': {
    padding: '4px 10px',
    fontSize: '0.8rem',
    border: `1px solid ${theme.colors.border.weak}`,
    background: 'transparent',
    color: theme.colors.text.secondary,
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
      borderColor: theme.colors.border.medium,
      color: theme.colors.text.primary,
      background: theme.colors.action.hover,
    },
  },

  // ─── SKIP BUTTON (shared) ─────────────────────────────────────────────────
  '.interactive-guided-skip-btn': {
    opacity: 0.8,
    '&:hover': {
      opacity: 1,
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
  // Slower, more readable draw animation (no fade-out since highlights persist)
  const drawMs = Math.max(500, Math.round(highlightMs * 0.65));
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
    .interactive-highlight-outline {
      position: absolute;
      top: var(--highlight-top);
      left: var(--highlight-left);
      width: var(--highlight-width);
      height: var(--highlight-height);
      pointer-events: none;
      z-index: ${INTERACTIVE_Z_INDEX.HIGHLIGHT_OUTLINE};
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
      /* Draw border animation, then breathing glow activates after draw completes */
      animation:
        interactive-draw-border ${drawMs}ms cubic-bezier(0.18, 0.6, 0.2, 1) forwards,
        interactive-glow-breathe 2s ease-in-out ${drawMs}ms infinite;
    }

    /* Subtle variant to reuse animation cadence for blocked areas */
    .interactive-highlight-outline--subtle {
      border-color: rgba(180, 180, 180, 0.4);
      background-color: rgba(180, 180, 180, 0.08);
      box-shadow: 0 0 0 4px rgba(180, 180, 180, 0.12);
      animation: subtle-highlight-pulse 1.6s ease-in-out infinite;
    }

    /* Hover highlight for element inspector (watch/record mode) */
    .interactive-hover-highlight-outline {
      position: absolute;
      top: var(--highlight-top);
      left: var(--highlight-left);
      width: var(--highlight-width);
      height: var(--highlight-height);
      pointer-events: none;
      z-index: ${INTERACTIVE_Z_INDEX.HIGHLIGHT_OUTLINE};
      border-radius: 4px;
      /* Same orange color as regular highlights for consistency */
      --hl-color: rgba(255, 136, 0, 0.85);
      --hl-thickness: 2px;
      background:
        linear-gradient(var(--hl-color) 0 0) top left / 0 var(--hl-thickness) no-repeat,
        linear-gradient(var(--hl-color) 0 0) top right / var(--hl-thickness) 0 no-repeat,
        linear-gradient(var(--hl-color) 0 0) bottom right / 0 var(--hl-thickness) no-repeat,
        linear-gradient(var(--hl-color) 0 0) bottom left / var(--hl-thickness) 0 no-repeat;
      /* No animation for hover - instant feedback */
      background-size: 100% var(--hl-thickness), var(--hl-thickness) 100%, 100% var(--hl-thickness), var(--hl-thickness) 100%;
      opacity: 0.95;
      /* Smooth transitions when moving between elements */
      transition: top 0.05s ease-out, left 0.05s ease-out, width 0.05s ease-out, height 0.05s ease-out;
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

    /* Breathing orange glow that activates after border draw completes */
    @keyframes interactive-glow-breathe {
      0%, 100% {
        box-shadow: 0 0 8px 2px rgba(255, 136, 0, 0.3);
      }
      50% {
        box-shadow: 0 0 16px 4px rgba(255, 136, 0, 0.5);
      }
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

    /* Spinner animation for loading states */
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Progress bar pulse animation */
    @keyframes progressPulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
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

    /* Interactive comment box - child of highlight, offset positioning */
    .interactive-comment-box {
      position: absolute;
      left: var(--comment-offset-x);
      top: var(--comment-offset-y);
      width: 420px;
      max-width: calc(100vw - 32px);
      pointer-events: none;
      z-index: ${INTERACTIVE_Z_INDEX.COMMENT_BOX};
      /* Initial state - hidden with slight offset for slide-in effect */
      opacity: 0;
      transform: scale(0.96);
      transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
                  transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* Slide-in from different directions based on position */
    .interactive-comment-box[data-position="right"] {
      transform: scale(0.96) translateX(-8px);
    }
    .interactive-comment-box[data-position="left"] {
      transform: scale(0.96) translateX(8px);
    }
    .interactive-comment-box[data-position="bottom"] {
      transform: scale(0.96) translateY(-8px);
    }
    .interactive-comment-box[data-position="top"] {
      transform: scale(0.96) translateY(8px);
    }

    /* Centered position for noop steps (no element to highlight) */
    .interactive-comment-box[data-position="center"] {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: scale(0.96) translate(-50%, -50%);
      z-index: 10001;
    }

    /* Noop comment boxes get a slightly different style */
    .interactive-comment-box[data-noop="true"] .interactive-comment-content::before {
      display: none; /* No arrow for centered boxes */
    }

    /* Final state - visible and in position */
    .interactive-comment-box[data-ready="true"] {
      opacity: 1;
      transform: scale(1) translateX(0) translateY(0);
    }

    .interactive-comment-box[data-ready="true"][data-position="center"] {
      transform: scale(1) translate(-50%, -50%);
    }

    .interactive-comment-content {
      border-radius: 8px;
      padding: 12px;
      font-size: 14px;
      line-height: 1.5;
      /* Layered shadow: soft glow + depth shadow */
      box-shadow: 
        0 0 20px rgba(255, 152, 0, 0.15),
        0 4px 20px rgba(0, 0, 0, 0.25),
        0 1px 3px rgba(0, 0, 0, 0.1);
      position: relative;
      /* Essential styling that needs to be global to avoid theme override conflicts */
      background: var(--grafana-colors-background-primary, #1f1f23);
      border: 1px solid rgba(255, 152, 0, 0.3);
      color: var(--grafana-colors-text-primary, #d9d9d9);
      /* Ensure content fits within container bounds */
      overflow: hidden;
      word-wrap: break-word;
      overflow-wrap: break-word;
      max-width: 100%;
      box-sizing: border-box;
    }

    /* Simple white close button for comment boxes */
    .interactive-comment-close {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: #ffffff;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: normal;
      line-height: 1;
      padding: 0;
      pointer-events: auto;
      transition: all 0.2s ease;
      z-index: 1;
      opacity: 0.7;
    }

    .interactive-comment-close:hover {
      background: rgba(255, 255, 255, 0.15);
      opacity: 1;
      transform: scale(1.1);
    }

    .interactive-comment-close:active {
      transform: scale(0.95);
    }

    /* Skip button for comment boxes (after instruction text) */
    .interactive-comment-skip-btn {
      position: static !important;
      padding: 6px 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.7);
      border-radius: 4px;
      cursor: pointer;
      display: block !important;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.3;
      pointer-events: auto;
      transition: all 0.2s ease;
      white-space: nowrap;
      width: fit-content;
      float: none !important;
      top: auto !important;
      right: auto !important;
      left: auto !important;
      bottom: auto !important;
    }

    .interactive-comment-skip-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.3);
      color: rgba(255, 255, 255, 0.9);
    }

    .interactive-comment-skip-btn:active {
      transform: scale(0.98);
    }

    /* Button container for skip and cancel buttons */
    .interactive-comment-buttons {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }

    /* Form validation status when inline with buttons */
    .interactive-comment-buttons .interactive-form-validation-status {
      margin-top: 0;
      flex: 1;
      min-width: 120px;
    }

    /* Cancel button for comment boxes - always available during guided execution */
    .interactive-comment-cancel-btn {
      position: static !important;
      padding: 6px 12px;
      border: 1px solid rgba(255, 100, 100, 0.3);
      background: rgba(255, 100, 100, 0.1);
      color: rgba(255, 200, 200, 0.9);
      border-radius: 4px;
      cursor: pointer;
      display: block !important;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.3;
      pointer-events: auto;
      transition: all 0.2s ease;
      white-space: nowrap;
      width: fit-content;
      float: none !important;
      top: auto !important;
      right: auto !important;
      left: auto !important;
      bottom: auto !important;
    }

    .interactive-comment-cancel-btn:hover {
      background: rgba(255, 100, 100, 0.25);
      border-color: rgba(255, 100, 100, 0.5);
      color: rgba(255, 220, 220, 1);
    }

    .interactive-comment-cancel-btn:active {
      transform: scale(0.98);
    }

    /* Orange glow border for comment boxes with entrance animation */
    .interactive-comment-glow {
      border: 1px solid rgba(255, 136, 0, 0.4) !important;
      animation: commentGlowEntrance 0.6s ease-out forwards;
    }

    @keyframes commentGlowEntrance {
      0% {
        box-shadow:
          0 4px 20px rgba(0, 0, 0, 0.25),
          0 0 0 0 rgba(255, 136, 0, 0),
          0 0 0 rgba(255, 136, 0, 0);
      }
      50% {
        box-shadow:
          0 4px 20px rgba(0, 0, 0, 0.25),
          0 0 0 4px rgba(255, 136, 0, 0.4),
          0 0 30px rgba(255, 136, 0, 0.3);
      }
      100% {
        box-shadow:
          0 4px 20px rgba(0, 0, 0, 0.25),
          0 0 0 2px rgba(255, 136, 0, 0.25),
          0 0 15px rgba(255, 136, 0, 0.15);
      }
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

    /* Arrow using CSS pseudo-element - positioned based on data-position */
    .interactive-comment-content::before {
      content: '';
      position: absolute;
      width: 0;
      height: 0;
    }

    /* Arrow pointing LEFT (comment is to the right of highlight) */
    .interactive-comment-box[data-position="right"] .interactive-comment-content::before {
      top: 50%;
      left: -8px;
      transform: translateY(-50%);
      border-top: 8px solid transparent;
      border-bottom: 8px solid transparent;
      border-right: 8px solid var(--grafana-colors-background-primary, #1f1f23);
    }

    /* Arrow pointing RIGHT (comment is to the left of highlight) */
    .interactive-comment-box[data-position="left"] .interactive-comment-content::before {
      top: 50%;
      right: -8px;
      left: auto;
      transform: translateY(-50%);
      border-top: 8px solid transparent;
      border-bottom: 8px solid transparent;
      border-left: 8px solid var(--grafana-colors-background-primary, #1f1f23);
    }

    /* Arrow pointing UP (comment is below highlight) */
    .interactive-comment-box[data-position="bottom"] .interactive-comment-content::before {
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-bottom: 8px solid var(--grafana-colors-background-primary, #1f1f23);
    }

    /* Arrow pointing DOWN (comment is above highlight) */
    .interactive-comment-box[data-position="top"] .interactive-comment-content::before {
      bottom: -8px;
      top: auto;
      left: 50%;
      transform: translateX(-50%);
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-top: 8px solid var(--grafana-colors-background-primary, #1f1f23);
    }

    /* Step checklist in guided comment tooltips */
    .interactive-comment-steps-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 14px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--grafana-colors-border-weak, #404040);
    }

    .interactive-comment-step-item {
      font-size: 13px;
      line-height: 1.4;
      color: var(--grafana-colors-text-secondary, #999999);
      padding: 2px 0;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .interactive-comment-step-item.interactive-comment-step-current {
      color: var(--grafana-colors-text-primary, #d9d9d9);
      font-weight: 500;
      background: rgba(255, 193, 7, 0.15);
      padding: 4px 6px;
      margin: -2px -4px;
      border-radius: 3px;
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

    /* Form validation status in comment box (for guided formfill steps) */
    .interactive-form-validation-status {
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .interactive-form-validation-status.form-checking {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: rgba(255, 255, 255, 0.8);
    }

    .interactive-form-validation-status.form-hint-warning {
      background: rgba(255, 193, 7, 0.2);
      border: 1px solid rgba(255, 193, 7, 0.4);
      color: rgba(255, 220, 150, 1);
    }

    .interactive-form-validation-status.form-valid {
      background: rgba(115, 191, 105, 0.2);
      border: 1px solid rgba(115, 191, 105, 0.4);
      color: rgba(115, 191, 105, 1);
    }

    .interactive-form-validation-status .interactive-form-spinner {
      animation: spin 1s linear infinite;
    }

    .interactive-form-validation-status .interactive-form-warning-icon {
      flex-shrink: 0;
    }

    .interactive-form-validation-status .interactive-form-success-icon {
      flex-shrink: 0;
      animation: popIn 0.3s ease-out;
    }

    @keyframes popIn {
      0% {
        transform: scale(0);
        opacity: 0;
      }
      50% {
        transform: scale(1.2);
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);
};
