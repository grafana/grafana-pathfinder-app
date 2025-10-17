import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getURLTesterStyles = (theme: GrafanaTheme2) => ({
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

  helpText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    marginTop: theme.spacing(0.5),
  }),
});
