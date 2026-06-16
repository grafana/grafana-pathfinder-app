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
  container: css({
    maxWidth: '1100px',
    width: '100%',
    margin: '0 auto',
    padding: theme.spacing(4),
  }),
  message: css({
    padding: theme.spacing(4),
    textAlign: 'center',
    color: theme.colors.text.secondary,
  }),
});
