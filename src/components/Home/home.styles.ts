import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

const topGlowLayers = [
  { color: '#FFFFFF', endColor: '#FFFFFF', opacity: 0.05, offset: 0.48519, transform: '0 46.9 -169.12 0 529.5 0' },
  { color: '#0952FF', endColor: '#008CE3', opacity: 0.1, offset: 0, transform: '14.1 48.65 -114.05 22.953 328 -176' },
  { color: '#B877D9', endColor: '#B877D9', opacity: 0.1, offset: 0, transform: '10.4 36.3 -67.911 19.456 903.5 0' },
  { color: '#F15A29', endColor: '#FFFFFF', opacity: 0.1, offset: 0, transform: '6.1 43.15 73.755 -10.426 1583 -89' },
];

const topGlow =
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1912 469" preserveAspectRatio="none">
  <defs>${topGlowLayers.map((layer, index) => `<radialGradient id="glow${index}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="10" gradientTransform="matrix(${layer.transform})"><stop offset="${layer.offset}" stop-color="${layer.color}" stop-opacity="${layer.opacity}"/><stop offset="1" stop-color="${layer.endColor}" stop-opacity="0"/></radialGradient>`).join('')}</defs>
  ${topGlowLayers.map((_, index) => `<rect width="1912" height="469" fill="url(#glow${index})"/>`).join('')}
</svg>`);

const getLearningBackground = (theme: GrafanaTheme2) => ({
  backgroundColor: theme.colors.background.page,
  backgroundImage: `url("data:image/svg+xml,${topGlow}")`,
  backgroundSize: '100% 469px',
  backgroundPosition: '0 0',
  backgroundRepeat: 'no-repeat',
});

export const getHomePageStyles = (theme: GrafanaTheme2) => {
  return {
    browseLayout: css({
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      ...getLearningBackground(theme),
    }),
    browseNavigation: css({
      flexShrink: 0,
      width: `calc(100% - ${theme.spacing(4)})`,
      maxWidth: `calc(1200px + ${theme.spacing(4)})`,
      marginInline: 'auto',
      padding: theme.spacing(10, 2, 0),
    }),
    heading: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(2), paddingTop: theme.spacing(10) }),
    headingText: css({ minWidth: 0 }),
    title: css({
      fontFamily: theme.typography.h1.fontFamily,
      fontSize: theme.typography.pxToRem(36),
      fontWeight: 600,
      lineHeight: 40 / 36,
      letterSpacing: '-0.013889em',
      color: theme.colors.text.primary,
      margin: 0,
    }),
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
      width: '100%',
      '[class*="-page-inner"]:has(&)': {
        width: `calc(100% - ${theme.spacing(4)})`,
        maxWidth: `calc(1200px + ${theme.spacing(6)})`,
        marginInline: 'auto',
        paddingInline: theme.spacing(2),
        paddingTop: 0,
        boxSizing: 'border-box',
      },
      '[class*="-page-inner"]:has(&) [class*="-page-header"]': {
        marginBottom: theme.spacing(1.5),
      },
      // Scenes owns the page wrapper; scope its background to this home panel.
      '[class*="-page-wrapper"]:has(&)': {
        ...getLearningBackground(theme),
      },
    }),
  };
};
