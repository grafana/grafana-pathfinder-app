import { css, keyframes } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

export const getGuideReaderStyles = (theme: GrafanaTheme2) => ({
  // Opaque (not the kiosk blur) so the Grafana page underneath is fully
  // hidden — the reader tab must read as a dedicated viewer, not a second
  // live Grafana the user can click into.
  backdrop: css({
    position: 'fixed',
    inset: 0,
    zIndex: 100000,
    background: theme.colors.background.canvas,
    overflow: 'auto',
    animation: `${fadeIn} 0.2s ease`,
  }),
  closeButton: css({
    position: 'fixed',
    top: theme.spacing(2),
    right: theme.spacing(2),
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  layoutRow: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(4),
    maxWidth: '1360px',
    width: '100%',
    margin: '0 auto',
  }),
  container: css({
    maxWidth: '1100px',
    width: '100%',
    margin: '0 auto',
    padding: theme.spacing(4),
    flex: 1,
    minWidth: 0,
  }),
  message: css({
    padding: theme.spacing(4),
    textAlign: 'center',
    color: theme.colors.text.secondary,
  }),
  outlineRail: css({
    width: '240px',
    flexShrink: 0,
    position: 'sticky',
    top: theme.spacing(8),
    maxHeight: `calc(100vh - ${theme.spacing(16)})`,
    overflowY: 'auto',
    padding: theme.spacing(4, 2),
    '@media (max-width: 1280px)': {
      display: 'none',
    },
  }),
  outlineList: css({
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  outlineItem: css({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderLeft: '2px solid transparent',
    padding: theme.spacing(0.5, 1.5),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    cursor: 'pointer',
    borderRadius: theme.shape.radius.default,
    '&:hover': {
      color: theme.colors.text.primary,
      background: theme.colors.action.hover,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.main}`,
      outlineOffset: '-2px',
    },
  }),
  outlineItemLevel2: css({
    paddingLeft: theme.spacing(1.5),
  }),
  outlineItemLevel3: css({
    paddingLeft: theme.spacing(3),
  }),
  outlineItemLevel4: css({
    paddingLeft: theme.spacing(4.5),
  }),
  outlineItemActive: css({
    color: theme.colors.text.primary,
    borderLeft: `2px solid ${theme.colors.primary.border}`,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  controllerStatus: css({
    position: 'fixed',
    top: theme.spacing(2),
    left: theme.spacing(2),
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 1.5),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: '999px',
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  controllerStatusDot: css({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  }),
  controllerStatusConnected: css({
    background: theme.colors.success.text,
  }),
  controllerStatusWaiting: css({
    background: theme.colors.warning.text,
  }),
});

export type GuideReaderStyles = ReturnType<typeof getGuideReaderStyles>;
