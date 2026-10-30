import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getHomePageStyles = (theme: GrafanaTheme2) => {
  return {
    browseLayout: css({
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      backgroundColor: theme.colors.background.page,
      backgroundImage: `radial-gradient(ellipse 1500px 1000px at 15% -120px, ${theme.colors.background.primary} 0%, ${theme.colors.background.primary} 25%, ${theme.colors.background.page} 100%)`,
    }),
    browseNavigation: css({
      width: '100%',
      maxWidth: `calc(1200px + ${theme.spacing(6)})`,
      marginInline: 'auto',
      padding: theme.spacing(2, 2, 0),
    }),
    heading: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(2) }),
    headingText: css({ minWidth: 0 }),
    title: css({ ...theme.typography.h1, margin: 0 }),
    subtitle: css({
      ...theme.typography.base,
      color: theme.colors.text.secondary,
      margin: 0,
      marginTop: theme.spacing(0.25),
    }),
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
      width: '100%',
      '[class*="-page-inner"]:has(&)': {
        width: '100%',
        maxWidth: `calc(1200px + ${theme.spacing(6)})`,
        marginInline: 'auto',
        paddingInline: theme.spacing(2),
        paddingTop: theme.spacing(6),
        boxSizing: 'border-box',
      },
      '[class*="-page-inner"]:has(&) [class*="-page-header"]': {
        marginBottom: theme.spacing(3),
      },
      '[class*="-page-inner"]:has(&) [class*="-title-subtitle-container"] > div:last-child': {
        ...theme.typography.base,
        fontSize: 16,
      },
      // Scenes owns the page wrapper; scope its background to this home panel.
      '[class*="-page-wrapper"]:has(&)': {
        backgroundColor: theme.colors.background.page,
        backgroundImage: `radial-gradient(ellipse 1500px 1000px at 15% -120px, ${theme.colors.background.primary} 0%, ${theme.colors.background.primary} 25%, ${theme.colors.background.page} 100%)`,
      },
    }),
  };
};
