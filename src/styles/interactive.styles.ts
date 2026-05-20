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

    '& > li[data-numbered="true"]': {
      counterIncrement: 'step-counter',
      position: 'relative',
      paddingLeft: theme.spacing(4), // Space for the number

      // Add the step number using ::before pseudo-element
      '&::before': {
        content: 'counter(step-counter) "."',
        position: 'absolute',
        left: 0,
        top: theme.spacing(2), // Aligns with the content start offset (see below)
        color: theme.colors.text.secondary,
        fontWeight: theme.typography.fontWeightMedium,
        fontSize: theme.typography.body.fontSize,
        width: theme.spacing(3),
        textAlign: 'right',
      },
    },

    // Interactive step components (InteractiveStep, InteractiveMultiStep, etc.)
    // carry their own CSS margin-top of theme.spacing(2), which naturally
    // positions the card 16px below the <li> top — matching the number's
    // top: theme.spacing(2). They also wrap content in a card with
    // padding: theme.spacing(2) (16px) and border: 2px solid transparent,
    // which insets the title text 18px from the card's left edge.
    // Their <li> therefore needs NO extra padding.
    //
    // Plain content blocks (markdown <p>, headings, etc.) have no built-in
    // margin-top OR card chrome, so they'd start at (top: 0, left: 0 inside
    // the li padding) while the step's title sits at
    // (top: theme.spacing(2), left: theme.spacing(2) + 2px) inside the li.
    // [data-step="false"] marks those <li> items; paddingTop pushes their
    // content down to align with the number, paddingLeft pushes them right
    // to align horizontally with the step title text.
    //
    // Verified at runtime (issue #841 alignment fix):
    //   step  title.x = li.x + 32 (li padding) + 2 (step border) + 16 (step padding) = li.x + 50
    //   plain title.x = li.x + 32 + 18 (extra padding) = li.x + 50  ✓
    '& > li[data-numbered="true"][data-step="false"]': {
      paddingTop: theme.spacing(2),
      paddingLeft: `calc(${theme.spacing(4)} + ${theme.spacing(2)} + 2px)`,
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

  // Section requirements banner (shown when section-level requirements are not met)
  // Styled to match individual step requirements (interactive-guided-requirement-box)
  '.interactive-section-requirements-banner': {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    margin: `${theme.spacing(1.5)} ${theme.spacing(2)} 0`,
    padding: '10px 12px',
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '6px',
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: theme.colors.text.secondary,
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
    padding: '8px 12px',
    background: theme.colors.info.transparent,
    border: `1px solid ${theme.colors.info.border}`,
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

  // ═══════════════════════════════════════════════════════════════════════════
  // LAZY SCROLL ERROR STYLES - For virtualized container discovery failures
  // Follows same style as requirement explanation (subtle, not warning)
  // ═══════════════════════════════════════════════════════════════════════════

  '.interactive-step-lazy-error': {
    marginTop: '12px',
    padding: '10px 12px',
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '6px',
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: theme.colors.text.secondary,
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
    ...getInteractiveSequenceStyles(theme),
    ...getCodeBlockStyles(theme),
    ...getInteractiveComponentStyles(theme),
    ...getExpandableStyles(theme),
  } as any);
