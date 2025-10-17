import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getDebugPanelStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),

  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  }),

  title: css({
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.h4.fontWeight,
    color: theme.colors.text.primary,
    margin: 0,
  }),

  badge: css({
    fontSize: theme.typography.bodySmall.fontSize,
  }),

  leaveDevModeRow: css({
    display: 'flex',
    justifyContent: 'center',
    marginBottom: theme.spacing(2),
    paddingBottom: theme.spacing(2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),

  section: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),

  sectionHeader: css({
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.secondary,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    transition: 'background-color 0.2s',
    '&:hover': {
      backgroundColor: theme.colors.emphasize(theme.colors.background.secondary, 0.03),
    },
  }),

  sectionTitle: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
  }),

  sectionContent: css({
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.primary,
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),

  formGroup: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  }),

  label: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(0.5),
  }),

  selectorInput: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),

  textArea: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    minHeight: '120px',
    resize: 'vertical',
  }),

  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  }),

  copiedButton: css({
    transition: 'all 0.3s ease-in-out',
    '&:hover': {
      transform: 'scale(1.05)',
    },
  }),

  resultBox: css({
    marginTop: theme.spacing(2),
    padding: theme.spacing(1.5),
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
  }),

  resultSuccess: css({
    color: theme.colors.success.text,
    backgroundColor: theme.colors.success.transparent,
    borderColor: theme.colors.success.border,
  }),

  resultError: css({
    color: theme.colors.error.text,
    backgroundColor: theme.colors.error.transparent,
    borderColor: theme.colors.error.border,
  }),

  resultText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    margin: 0,
  }),

  matchCount: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.primary.transparent,
    color: theme.colors.primary.text,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),

  helpText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    marginTop: theme.spacing(0.5),
  }),

  exampleCode: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    backgroundColor: theme.colors.background.secondary,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    display: 'block',
    marginTop: theme.spacing(0.5),
  }),

  progressIndicator: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.info.transparent,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.info.text,
    fontSize: theme.typography.bodySmall.fontSize,
    marginTop: theme.spacing(1),
  }),

  // Guided progress styles
  guidedProgress: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.warning.transparent,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.warning.text,
    fontSize: theme.typography.bodySmall.fontSize,
    marginTop: theme.spacing(1),
  }),

  guidedStepHint: css({
    marginTop: theme.spacing(0.5),
    paddingLeft: theme.spacing(3),
  }),

  dropdownRow: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-end',
  }),

  dropdownField: css({
    flex: 1,
  }),

  // Watch Mode styles
  watchModeActive: css({
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

  watchModeHint: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.info.transparent,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.info.text,
    fontSize: theme.typography.bodySmall.fontSize,
  }),

  selectorMeta: css({
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  }),

  // Record Mode styles
  recordModeControls: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    flexWrap: 'wrap',
  }),

  recordModeActive: css({
    animation: 'pulse 2s ease-in-out infinite',
  }),

  recordModeHint: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.error.transparent,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.error.text,
    fontSize: theme.typography.bodySmall.fontSize,
  }),

  recordedStepsList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    maxHeight: '300px',
    overflowY: 'auto',
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),

  recordedStep: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),

  stepNumber: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    borderRadius: '50%',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    flexShrink: 0,
  }),

  stepDetails: css({
    flex: 1,
    minWidth: 0,
    maxWidth: 'calc(100% - 60px)', // Account for step number and delete button
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

  stepCode: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: '11px',
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.secondary,
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.default,
    display: 'block',
    wordBreak: 'break-all',
    overflowWrap: 'break-word',
    wordWrap: 'break-word',
    whiteSpace: 'pre-wrap',
    maxWidth: '100%',
  }),

  warningIcon: css({
    marginLeft: theme.spacing(0.5),
    color: theme.colors.warning.text,
    verticalAlign: 'middle',
  }),

  stepMeta: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(0.5),
    flexWrap: 'wrap',
  }),
});
