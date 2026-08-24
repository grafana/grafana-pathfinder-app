import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export { updateInteractiveThemeColors } from './interactive.theme-bridge';
export { addGlobalInteractiveStyles } from './interactive.overlay.styles';

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

const GUIDE_ACTION_BUTTON_SELECTOR = [
  '.interactive-step-action-buttons > button',
  '.interactive-guided-actions > button',
  '.interactive-guided-executing > button',
  '.interactive-guided-error-actions > button',
  '.interactive-guided-cancelled-actions > button',
  '.interactive-guided-completed > button',
  '.interactive-section-actions > button',
].join(', ');

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

  '.interactive-section-hint': {
    color: theme.colors.text.secondary,
    fontSize: '14px',
    cursor: 'help',
    '&:hover': {
      color: theme.colors.text.primary,
    },
  },

  // Per Figma design, buttons in guides have specialized padding
  [GUIDE_ACTION_BUTTON_SELECTOR]: {
    padding: '0px 12px',
  },

  // Interactive Conditional loading styles
  '.interactive-conditional.loading': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(3),
    margin: `${theme.spacing(2)} 0`,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    minHeight: '80px',
  },

  '.interactive-conditional-loading': {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    color: theme.colors.text.secondary,
  },

  '.interactive-conditional-spinner': {
    fontSize: '18px',
    color: theme.colors.primary.main,
    '&.spinning': {
      animation: 'spin 1s linear infinite',
    },
  },

  '.interactive-conditional-loading-text': {
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  },

  '.interactive-section-description': {
    padding: `0 ${theme.spacing(2)} ${theme.spacing(1.5)}`,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  },

  '.interactive-section-content': {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2),
    opacity: 1,
    maxHeight: '10000px',
    overflow: 'hidden',
    transition: 'opacity 0.3s ease, max-height 0.3s ease',
    margin: 0,
    listStyle: 'none', // Hide default markers since we use CSS counters
    counterReset: 'step-counter', // Initialize counter

    // Every direct child sits in a wrapper <li>. Only li[data-numbered="true"]
    // participates in the sequential numbering — media (image/video) and wrapper
    // (conditional) blocks render without a number. See issue #841.
    '& > li': {
      listStyle: 'none',
    },

    // Interactive blocks keep local margins for standalone guide-root and
    // inline-conditional mounts. Inside a section, this flex container's gap
    // is the single vertical rhythm, so suppress those component-owned margins.
    // Scope to data-step=true to preserve authored prose and media spacing.
    '& > li[data-step="true"] > *': {
      marginTop: 0,
      marginBottom: 0,
    },

    '& > li[data-numbered="true"]': {
      counterIncrement: 'step-counter',
    },

    '& > li[data-numbered="true"][data-step="true"] > :first-child': {
      position: 'relative',
      paddingLeft: theme.spacing(4),
      paddingRight: theme.spacing(4),

      // InteractiveStep owns padding when mounted standalone. In a section,
      // active steps borrow the section's vertical inset while retaining the
      // horizontal number gutter above. Terminal states remain self-padded.
      '&.interactive-step:not(.completed):not(.skipped)': {
        paddingTop: 0,
        paddingBottom: 0,
      },

      // Anchor the number to the block's own top inset so it lines up with the
      // first line of text. Default assumes a self-padded card (quiz, input,
      // challenge and grot-guide all use spacing(2)); interactive-step is flush
      // until it reaches a terminal state, so it opts out below.
      '&::before': {
        content: 'counter(step-counter) "."',
        position: 'absolute',
        left: 0,
        top: theme.spacing(2),
        color: theme.colors.text.secondary,
        fontWeight: theme.typography.fontWeightMedium,
        fontSize: theme.typography.body.fontSize,
        width: theme.spacing(3),
        textAlign: 'right',
      },

      '&.interactive-step::before': {
        top: 0,
      },

      '&.interactive-step.completed::before, &.interactive-step.skipped::before': {
        top: theme.spacing(2),
      },
    },

    // Plain content has no card to contain the number. Give the list item the
    // same horizontal inset as a step card, while leaving vertical rhythm to
    // the section gap just like data-step=true items.
    '& > li[data-numbered="true"][data-step="false"]': {
      position: 'relative',
      paddingLeft: theme.spacing(4),
      paddingRight: theme.spacing(4),

      '& > :first-child': {
        marginTop: 0,
        marginBottom: 0,
      },

      '&::before': {
        content: 'counter(step-counter) "."',
        position: 'absolute',
        left: 0,
        top: 0,
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

  // Section requirements banner (shown when section-level requirements are not met)
  '.interactive-section-requirements-banner': {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    margin: `${theme.spacing(1.5)} ${theme.spacing(2)} 0`,
  },

  '.interactive-section-requirements-content': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },

  '.interactive-section-requirements-icon': {
    color: theme.colors.text.secondary,
    fontSize: '1rem',
    lineHeight: 1.4,
    flexShrink: 0,
  },

  '.interactive-section-requirements-message': {
    color: theme.colors.text.secondary,
    fontSize: '0.875rem',
    lineHeight: 1.4,
  },

  // Alignment paused banner (implied 0th step) — info-blue to match the top
  // AlignmentPrompt (which uses Alert severity="info"), no icon, with link
  // back to the top prompt. Distinct from the generic requirements banner
  // because the paused state is recoverable via the prompt above.
  '.interactive-section-alignment-banner': {
    margin: `${theme.spacing(1.5)} ${theme.spacing(2)} 0`,
    borderLeft: `3px solid ${theme.colors.info.main}`,
    borderRadius: '4px',
  },

  '.interactive-section-alignment-message': {
    color: theme.colors.info.text,
    fontSize: '0.875rem',
    lineHeight: 1.4,
  },

  '.interactive-section-alignment-link': {
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    color: theme.colors.info.text,
    fontSize: 'inherit',
    fontFamily: 'inherit',
    fontWeight: theme.typography.fontWeightMedium,
    textDecoration: 'underline',
    cursor: 'pointer',
    '&:hover': {
      textDecoration: 'none',
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.info.main}`,
      outlineOffset: '2px',
      borderRadius: '2px',
    },
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
  // Keep outer margin for standalone / guide-root mounts. Inside a section,
  // `.interactive-section-content > li[data-step="true"] > *` zeroes it so the
  // section gap owns vertical rhythm.
  '.interactive-step': {
    display: 'flex',
    flexDirection: 'column',
    margin: `${theme.spacing(2)} 0`,
    padding: theme.spacing(2),
    gap: theme.spacing(1),
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

  '.interactive-step-content > p': {
    marginBottom: 0,
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

    '&:not(:has(button)):not(:has(.interactive-guided-completed))': {
      display: 'none',
    },
  },

  '.interactive-step-action-buttons': {
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
  },

  '.interactive-step-show-btn': {
    fontSize: theme.typography.bodySmall.fontSize,
  },

  '.interactive-step-do-btn': {
    fontSize: theme.typography.bodySmall.fontSize,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUIREMENT/INFO STYLES - Subtle box for sequential step messaging
  // ═══════════════════════════════════════════════════════════════════════════

  // Shared compact shell for status/feedback chrome across guide block types.
  // May contain action buttons; components add only layout or deviant chrome.
  '.interactive-feedback-box': {
    padding: theme.spacing(0.5, 1.5),
    borderRadius: '6px',
    border: '1px solid transparent',
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.4,
    minWidth: 0,
  },

  '.interactive-feedback-box--neutral': {
    background: theme.colors.background.secondary,
    borderColor: theme.colors.border.medium,
    color: theme.colors.text.secondary,
  },

  '.interactive-feedback-box--warning': {
    background: theme.colors.warning.transparent,
    borderColor: theme.colors.warning.border,
    color: theme.colors.warning.text,
  },

  '.interactive-feedback-box--info': {
    background: theme.colors.info.transparent,
    borderColor: theme.colors.info.border,
    color: theme.colors.info.text,
  },

  '.interactive-feedback-box--success': {
    background: theme.colors.success.transparent,
    borderColor: theme.colors.success.border,
    color: theme.colors.success.text,
  },

  '.interactive-feedback-box--muted': {
    background: theme.colors.secondary.transparent,
    borderColor: theme.colors.border.medium,
    color: theme.colors.text.secondary,
  },

  '.interactive-step-requirement-explanation': {
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
    top: theme.spacing(0.5),
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

    '&:empty': {
      display: 'none',
    },
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

  // ═══════════════════════════════════════════════════════════════════════════
  // LAZY SCROLL ERROR STYLES - For virtualized container discovery failures
  // Follows same style as requirement explanation (subtle, not warning)
  // ═══════════════════════════════════════════════════════════════════════════

  '.interactive-step-lazy-error': {
    // Add scroll icon via ::before with inline layout
    '&::before': {
      content: '"↕"',
      marginRight: '8px',
      fontSize: '0.9rem',
    },
  },

  '.interactive-lazy-error-text': {
    display: 'inline',
  },

  '.interactive-lazy-retry-btn': {
    padding: '4px 10px',
    fontSize: '0.8rem',
    fontWeight: 500,
    border: `1px solid ${theme.colors.border.medium}`,
    background: 'transparent',
    color: theme.colors.text.secondary,
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    marginLeft: '8px',
    '&:hover': {
      borderColor: theme.colors.text.secondary,
      background: theme.colors.action.hover,
    },
    '&:disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM VALIDATION STYLES - Checking indicator and validation hint warning
  // ═══════════════════════════════════════════════════════════════════════════

  // Form checking indicator (shown during 2s debounce)
  '.interactive-step-form-checking': {
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

  '.interactive-guided-actions': {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },

  '.interactive-guided-start-btn': {
    fontWeight: 500,
  },

  // ─── CHECKING STATE ───────────────────────────────────────────────────────
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
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),

    '&.rechecking': {
      opacity: 0.85,
    },
  },

  '.interactive-guided-requirement-box': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    position: 'relative',
  },

  '.interactive-guided-requirement-icon': {
    color: theme.colors.text.secondary,
    fontSize: '1rem',
    lineHeight: 1.4,
    flexShrink: 0,
  },

  '.interactive-guided-requirement-text': {
    color: 'inherit',
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

  '.interactive-requirement-ai-fix-btn, .interactive-guided-ai-fix-btn': {
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
    '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
  },

  '.interactive-step-lazy-error .interactive-requirement-ai-fix-btn': {
    marginLeft: '8px',
  },

  // ─── EXECUTING STATE ──────────────────────────────────────────────────────
  '.interactive-guided-executing': {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  },

  '.interactive-guided-step-indicator': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
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
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  },

  '.interactive-guided-error-box': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
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
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },

  '.interactive-guided-cancelled-text': {
    color: 'inherit',
  },

  '.interactive-guided-cancelled-actions': {
    display: 'flex',
    gap: '8px',
  },

  // ─── COMPLETED STATE ──────────────────────────────────────────────────────
  '.interactive-guided-completed': {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },

  '.interactive-guided-completed-badge': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 12px',
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
    ...getInteractiveSequenceStyles(theme),
    ...getCodeBlockStyles(theme),
    ...getInteractiveComponentStyles(theme),
    ...getExpandableStyles(theme),
  } as any);
