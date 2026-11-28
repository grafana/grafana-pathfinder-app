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
  '.code-block': {
    margin: `${theme.spacing(2)} 0`,

    '& > pre.code-block-pre': {
      ...theme.typography.code,
      fontSize: theme.typography.sm.fontSize,
      margin: 0,
      padding: theme.spacing(1.5, 1),
      overflow: 'auto',
      background: theme.colors.background.primary,
      border: 0,
      borderRadius: theme.shape.radius.md,
      color: theme.colors.text.primary,

      '& > code': {
        background: 'transparent',
        padding: 0,
        font: 'inherit',
        letterSpacing: 'inherit',
        color: 'inherit',
      },
    },
  },

  '.code-block-header': {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(0.5),
  },

  '.code-block-language': {
    marginInlineEnd: 'auto',
    fontSize: theme.typography.sm.fontSize,
    lineHeight: theme.typography.sm.lineHeight,
    color: theme.colors.text.secondary,
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

const visibleStepContent = ':not(.section-numbering-empty, .section-numbering-retained)';
const visibleSectionItem = 'li:not(:empty, :has(> :is(.section-numbering-empty, .section-numbering-retained)))';
const visibleNumberedSectionItem = `${visibleSectionItem}[data-numbered="true"]`;

const getStepNoticeStyles = (theme: GrafanaTheme2, tone?: 'info' | 'warning') => {
  const color = tone && theme.colors[tone];
  const refresh = theme.flags.visualDesignRefresh;
  const background = color ? (refresh ? color.subtleBackground : color.transparent) : theme.colors.background.primary;
  const border = color ? (refresh ? color.subtleBorder : color.borderTransparent) : theme.colors.border.weak;
  return {
    ...theme.typography.sm,
    padding: theme.spacing(1),
    border: `1px solid ${border}`,
    borderRadius: theme.shape.radius.md,
    color: color ? (refresh ? color.textEmphasis : theme.colors.text.primary) : theme.colors.text.secondary,
    backgroundColor: refresh || !color ? background : theme.colors.background.primary,
    backgroundImage: !refresh && color ? `linear-gradient(${background}, ${background})` : undefined,
    '--step-notice-icon': color ? color.text : theme.colors.text.secondary,
  };
};

// Interactive component styles (sections and steps)
const getInteractiveComponentStyles = (theme: GrafanaTheme2) => ({
  // Interactive Section styles
  '.interactive-section': {
    margin: theme.spacing(3, 0),
    borderRadius: theme.shape.radius.lg,
    backgroundColor: theme.colors.background.primary,
    boxShadow: theme.shadows.z1,
    '&.completed > .interactive-section-body': {
      borderColor: theme.colors.success.border,
    },
  },

  '.interactive-section-header': {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    '&:not(.journey-collapse-trigger)': {
      padding: theme.spacing(2),
    },
    '&.journey-collapse-trigger': {
      borderRadius: theme.shape.radius.lg,
      textAlign: 'start',
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.accent?.main ?? theme.colors.primary.main}`,
        outlineOffset: '-2px',
      },
    },
  },

  '.interactive-section-title-container': {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    flex: 1,
    minWidth: 0,
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
    ...theme.typography.base,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    overflowWrap: 'anywhere',
  },

  '.interactive-section-checkmark': {
    color: theme.colors.success.text,
    flexShrink: 0,
  },

  '.interactive-section-hint': {
    display: 'inline-flex',
    color: theme.colors.text.secondary,
    cursor: 'help',
    flexShrink: 0,
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
    ...theme.typography.base,
    color: theme.colors.text.secondary,
  },

  '.interactive-section-body': {
    '--section-body-padding': `calc(${theme.spacing(2)} - 1px)`,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    padding: 'var(--section-body-padding)',
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.lg,
    '&[hidden]': { display: 'none' },
  },

  'ol.interactive-section-content': {
    padding: 0,
    margin: 0,
    listStyle: 'none',
    counterReset: 'step-counter',

    '& > li': {
      listStyle: 'none',
      margin: 0,
      display: 'flow-root',
    },
    '& > li:empty, & > li:has(> .section-numbering-empty)': {
      display: 'none',
    },
    [`& > ${visibleSectionItem}:has(~ li > ${visibleStepContent})`]: {
      paddingBlockEnd: theme.spacing(3),
    },
    '& > li[data-numbered="true"]': {
      counterIncrement: 'step-counter',
      position: 'relative',
    },
    [`& > ${visibleNumberedSectionItem}`]: {
      minBlockSize: theme.spacing(3),
      paddingInlineStart: theme.spacing(5),
      '&::before': {
        content: 'counter(step-counter)',
        position: 'absolute',
        insetInlineStart: 0,
        insetBlockStart: 0,
        display: 'grid',
        placeItems: 'center',
        boxSizing: 'border-box',
        width: theme.spacing(3),
        height: theme.spacing(3),
        border: `1px solid ${theme.colors.border.medium}`,
        borderRadius: '50%',
        backgroundColor: theme.colors.background.primary,
        color: theme.colors.text.primary,
        ...theme.typography.base,
        lineHeight: 1,
      },
      '&:has(> .interactive-step.completed, > .interactive-conditional > .interactive-step.completed)::before': {
        borderColor: theme.colors.success.border,
        color: theme.colors.success.text,
      },
    },
    // A previously visible conditional still reserves its number while hidden.
    '& > li[data-numbered="true"]:has(> .section-numbering-retained)': {
      height: 0,
      overflow: 'hidden',
      padding: 0,
    },

    '& > li > :first-child, & > li > .interactive-conditional > :first-child': { marginBlockStart: 0 },
    '& > li > :last-child, & > li > .interactive-conditional > :last-child': { marginBlockEnd: 0 },
    '& > li > .interactive-step, & > li > .interactive-conditional .interactive-step': {
      margin: 0,
      padding: 0,
      border: 0,
      backgroundColor: 'transparent',
      '&:is(.completed, .skipped, .executing)': { backgroundColor: 'transparent' },
    },
    '& .interactive-step-content': {
      margin: 0,
      '& > :first-child': { marginBlockStart: 0 },
      '& > :last-child, & > :is(.markdown-block, .html-block):last-child > :last-child': { marginBlockEnd: 0 },
    },
    '& .interactive-step-actions:has(.interactive-step-action-buttons > *, .interactive-guided-completed)': {
      marginBlockStart: theme.spacing(1),
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
    ...getStepNoticeStyles(theme, 'warning'),
    margin: theme.spacing(2, 2, 0),
  },

  '.interactive-notice-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: theme.spacing(3),
    height: theme.spacing(3),
    flexShrink: 0,
    borderRadius: theme.shape.radius.sm,
    color: 'var(--step-notice-icon)',
    backgroundColor: 'color-mix(in srgb, var(--step-notice-icon) 8%, transparent)',
  },

  '.interactive-section-requirements-banner': {
    ...getStepNoticeStyles(theme, 'warning'),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    '& > .interactive-step-requirement-buttons': { margin: 0 },
  },

  '.interactive-section-requirements-content, .interactive-section-alignment-banner': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
  },

  '.interactive-section-requirements-message, .interactive-section-alignment-message': {
    paddingBlock: theme.spacing(0.25),
    minWidth: 0,
  },

  '.interactive-section-recovery, .interactive-completion-waiting': {
    ...getStepNoticeStyles(theme, 'info'),
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
  },

  '.interactive-step-content > .interactive-completion-waiting': {
    marginBlock: theme.spacing(1),
  },

  '.interactive-section-recovery-label': {
    flex: '1 1 auto',
  },

  '.recovery-paused .interactive-section-content .interactive-step-requirement-explanation, .recovery-paused .interactive-section-content .interactive-guided-requirement-box':
    {
      display: 'none',
    },

  '.interactive-section-alignment-banner': {
    ...getStepNoticeStyles(theme, 'info'),
  },

  '.interactive-section-alignment-link': {
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    color: 'inherit',
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
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    marginBlockStart: theme.spacing(1),
    paddingBlockStart: 'var(--section-body-padding)',
    borderBlockStart: `1px solid ${theme.colors.border.weak}`,
    '& > :is(.interactive-guided-executing, .interactive-completion-waiting)': { margin: 0 },
  },

  '.interactive-section-buttons': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
    '& > .interactive-section-do-button': { marginInlineStart: 'auto' },
  },

  '.interactive-section-do-button, .interactive-section-reset-button': {
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
    borderRadius: theme.shape.radius.lg,
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

  '.interactive-step.interactive-code-block-step': {
    padding: 0,
    backgroundColor: 'transparent',
    border: 0,
    boxShadow: 'none',

    '&.executing > .code-block > .code-block-pre': {
      boxShadow: `inset 0 0 0 1px ${theme.colors.success.main}`,
    },
  },

  '.interactive-step-content': {
    marginBottom: theme.spacing(1.5),
  },

  '.interactive-step-title': {
    fontSize: theme.typography.base.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(0.5),
  },

  '.interactive-step-description': {
    fontSize: theme.typography.sm.fontSize,
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
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    alignItems: 'center',
  },

  '.interactive-step-show-btn': {
    fontSize: theme.typography.sm.fontSize,
  },

  '.interactive-step-do-btn': {
    fontSize: theme.typography.sm.fontSize,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUIREMENT/INFO STYLES - Subtle box for sequential step messaging
  // ═══════════════════════════════════════════════════════════════════════════

  '.interactive-step-requirement-explanation': {
    ...getStepNoticeStyles(theme),
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'start',
    gap: theme.spacing(0.5, 1),
    position: 'relative',
    marginBlockStart: theme.spacing(1),
    '& > :not(.interactive-notice-icon)': { gridColumn: 2 },
    '& > :nth-child(2)': { paddingBlock: theme.spacing(0.25) },
    '& > .interactive-step-requirement-buttons': { margin: 0 },
    '&.rechecking': { opacity: 0.85 },
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

  '.interactive-step-recovery-hint': {
    display: 'block',
    marginTop: theme.spacing(0.5),
    padding: 0,
    border: 'none',
    background: 'none',
    font: 'inherit',
    color: theme.colors.text.link,
    textDecoration: 'underline',
    cursor: 'pointer',
  },

  '.interactive-step-revealed': {
    boxShadow: `0 0 0 2px ${theme.colors.accent?.border ?? theme.colors.primary.border}`,
    transition: 'box-shadow 0.3s ease',
  },

  '.interactive-step-requirement-buttons': {
    display: 'flex',
    flexWrap: 'wrap',
    '&:empty': { display: 'none' },
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
    ...getStepNoticeStyles(theme, 'warning'),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBlockStart: theme.spacing(1),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LAZY SCROLL ERROR STYLES - For virtualized container discovery failures
  // Follows same style as requirement explanation (subtle, not warning)
  // ═══════════════════════════════════════════════════════════════════════════

  '.interactive-step-lazy-error': {
    ...getStepNoticeStyles(theme),
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginBlockStart: theme.spacing(1),
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
    ...getStepNoticeStyles(theme, 'info'),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBlockStart: theme.spacing(1),
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
    ...getStepNoticeStyles(theme, 'warning'),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBlockStart: theme.spacing(1),
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
    borderTopColor: theme.colors.accent?.main ?? theme.colors.primary.main,
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
    ...getStepNoticeStyles(theme),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBlockEnd: theme.spacing(1),
    position: 'relative',
  },

  '.interactive-guided-fix-btn': {
    padding: '6px 12px',
    fontSize: '0.8rem',
    fontWeight: 500,
    border: `1px solid ${theme.colors.border.medium}`,
    background: 'transparent',
    color: theme.colors.text.secondary,
    borderRadius: theme.shape.radius.md,
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
    borderRadius: theme.shape.radius.sm,
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
    borderRadius: theme.shape.radius.sm,
    marginBottom: '14px',
    overflow: 'hidden',
  },

  '.interactive-guided-progress-fill': {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    background: theme.colors.success.shade,
    borderRadius: theme.shape.radius.sm,
    transition: 'width 0.3s ease',
  },

  '.interactive-guided-progress-active': {
    position: 'absolute',
    top: 0,
    height: '100%',
    background: `linear-gradient(90deg, ${theme.colors.accent?.main ?? theme.colors.primary.main} 0%, ${theme.colors.accent?.mainEmphasis ?? theme.colors.primary.shade} 100%)`,
    borderRadius: theme.shape.radius.sm,
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
    ...getStepNoticeStyles(theme, 'warning'),
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    marginBlockEnd: theme.spacing(1),
  },

  '.interactive-guided-error-content': {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },

  '.interactive-guided-error-title': {
    fontWeight: theme.typography.fontWeightMedium,
  },

  '.interactive-guided-error-detail': {
    overflowWrap: 'anywhere',
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
