import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getTeamProgressStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    padding: theme.spacing(3),
    maxWidth: 1200,
    margin: '0 auto',
    width: '100%',
    gap: theme.spacing(3),
  }),
  emptyState: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: theme.spacing(4),
    color: theme.colors.text.secondary,
  }),
  statRow: css({
    height: 150,
    width: '100%',
    '& > div': {
      height: '100%',
    },
  }),
  chartContainer: css({
    height: 250,
    width: '100%',
  }),
});
