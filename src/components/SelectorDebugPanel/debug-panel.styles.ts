import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getDebugPanelStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1),
  }),

  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: theme.spacing(1.5),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),

  badge: css({
    fontSize: theme.typography.bodySmall.fontSize,
  }),

  section: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),

  sectionHeader: css({
    padding: theme.spacing(1.5),
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
});
