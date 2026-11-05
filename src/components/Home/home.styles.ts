import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

const topGlowLayers = [
  { color: '#FFFFFF', endColor: '#FFFFFF', opacity: 0.02, offset: 0.48519, transform: '0 46.9 -169.12 0 529.5 0' },
  { color: '#B9AFF2', endColor: '#B9AFF2', opacity: 0.12, offset: 0, transform: '14.1 48.65 -114.05 22.953 328 -70' },
  { color: '#8FADE6', endColor: '#8FADE6', opacity: 0.085, offset: 0, transform: '10.4 40 -115 19.456 1160 0' },
  { color: '#8FADE6', endColor: '#8FADE6', opacity: 0.035, offset: 0, transform: '6.1 44 105 -10.426 1810 -35' },
];

const topGlow = (strength = 1) =>
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1912 469" preserveAspectRatio="none">
  <defs>${topGlowLayers.map((layer, index) => `<radialGradient id="glow${index}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="10" gradientTransform="matrix(${layer.transform})"><stop offset="${layer.offset}" stop-color="${layer.color}" stop-opacity="${layer.opacity * (index === 0 ? 1 : strength)}"/><stop offset="1" stop-color="${layer.endColor}" stop-opacity="0"/></radialGradient>`).join('')}</defs>
  ${topGlowLayers.map((_, index) => `<rect width="1912" height="469" fill="url(#glow${index})"/>`).join('')}
</svg>`);

const getLearningBackground = (theme: GrafanaTheme2) => {
  const dots =
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1912" height="1000" viewBox="0 0 1912 1000">
    <defs>
      <pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="color-mix(in srgb, ${theme.colors.text.secondary} 22%, transparent)"/></pattern>
      <radialGradient id="fade" cx="25%" cy="0%" r="70%"><stop stop-color="white" stop-opacity="0.6"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient>
      <mask id="dotFade"><rect width="1912" height="1000" fill="url(#fade)"/></mask>
    </defs>
    <rect width="1912" height="1000" fill="url(#dots)" mask="url(#dotFade)"/>
  </svg>`);
  return {
    backgroundColor: theme.colors.background.page,
    backgroundImage: `url("data:image/svg+xml,${dots}"), url("data:image/svg+xml,${topGlow(1.5)}")`,
    backgroundSize: 'auto 1000px, 100% 850px',
    backgroundPosition: 'top center',
    backgroundRepeat: 'no-repeat',
  };
};

export const getHomePageStyles = (theme: GrafanaTheme2) => {
  return {
    browseLayout: css({
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      '[class*="-page-wrapper"]:has(&)': {
        ...getLearningBackground(theme),
      },
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
