import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getPrTesterStyles = (theme: GrafanaTheme2) => ({
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

  urlInput: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),

  helpText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    marginTop: theme.spacing(0.5),
  }),

  buttonRow: css({
    marginTop: theme.spacing(1),
  }),

  selectContainer: css({
    marginTop: theme.spacing(1.5),
  }),

  readyText: css({
    marginTop: theme.spacing(1.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),

  statusBadge: css({
    marginLeft: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    padding: `0 ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    textTransform: 'lowercase',
  }),

  statusAdded: css({
    backgroundColor: theme.colors.success.transparent,
    color: theme.colors.success.text,
  }),

  statusModified: css({
    backgroundColor: theme.colors.warning.transparent,
    color: theme.colors.warning.text,
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
});
