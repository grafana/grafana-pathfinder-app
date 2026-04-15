import { css, keyframes } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { INTERACTIVE_Z_INDEX } from '../../constants/interactive-z-index';

const pulseAnimation = keyframes`
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(110, 159, 255, 0.7);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(110, 159, 255, 0);
  }
`;

export const getFloatingPanelStyles = (theme: GrafanaTheme2) => ({
  /** Outer container — fixed-positioned, draggable, resizable */
  panel: css({
    position: 'fixed',
    zIndex: INTERACTIVE_Z_INDEX.FLOATING_PANEL,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    overflow: 'hidden',
    transition: 'box-shadow 300ms ease, border-color 300ms ease',

    '&:hover': {
      boxShadow: `${theme.shadows.z3}, 0 0 0 1px ${theme.colors.border.medium}`,
    },
  }),

  /** Animated position transition used during highlight dodge */
  panelDodging: css({
    transition: 'left 200ms ease-out, top 200ms ease-out, box-shadow 300ms ease, border-color 300ms ease',
    borderColor: theme.colors.warning.border,
    boxShadow: `${theme.shadows.z3}, 0 0 6px ${theme.colors.warning.transparent}`,
  }),

  /** Header bar — drag handle */
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    backgroundColor: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'grab',
    userSelect: 'none',
    flexShrink: 0,

    '&:active': {
      cursor: 'grabbing',
    },
  }),

  /** Guide title in header */
  headerTitle: css({
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),

  /** Step counter badge */
  stepCounter: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }),

  /** Header action buttons */
  headerActions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    flexShrink: 0,
  }),

  /** Scrollable content area */
  content: css({
    flex: 1,
    overflow: 'auto',
    minHeight: 0,
    padding: theme.spacing(1),
  }),

  /** Resize handle in bottom-right corner */
  resizeHandle: css({
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    cursor: 'nwse-resize',
    // Triangular resize grip
    '&::after': {
      content: '""',
      position: 'absolute',
      bottom: 2,
      right: 2,
      width: 0,
      height: 0,
      borderStyle: 'solid',
      borderWidth: '0 0 8px 8px',
      borderColor: `transparent transparent ${theme.colors.text.disabled} transparent`,
    },
  }),

  /** Minimized pill state — wrapper div handles fixed positioning */
  pill: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: '50%',
    backgroundColor: theme.colors.background.primary,
    border: `2px solid ${theme.colors.primary.main}`,
    boxShadow: theme.shadows.z3,
    cursor: 'pointer',
    transition: 'all 0.2s ease-in-out',

    '&:hover': {
      transform: 'scale(1.1)',
      boxShadow: theme.shadows.z3,
      borderColor: theme.colors.primary.shade,
    },

    '&:active': {
      transform: 'scale(0.95)',
    },
  }),

  pillActive: css({
    animation: `${pulseAnimation} 2s ease-in-out infinite`,
  }),

  pillLogo: css({
    width: 28,
    height: 28,
  }),

  pillBadge: css({
    position: 'absolute',
    top: -4,
    right: -4,
  }),

  pillWrapper: css({
    position: 'relative',
  }),
});
