/**
 * Terminal panel styles
 *
 * Styles for the collapsible, resizable terminal panel
 * that appears at the bottom of the sidebar.
 */

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getTerminalPanelStyles = (theme: GrafanaTheme2) => ({
  // Outer container - handles collapse/expand
  container: css({
    label: 'coda-terminal-container',
    display: 'flex',
    flexDirection: 'column',
    borderTop: `1px solid ${theme.colors.border.medium}`,
    backgroundColor: theme.colors.background.primary,
    flexShrink: 0,
    overflow: 'hidden',
  }),

  // Collapsed state - only shows header bar
  collapsed: css({
    label: 'coda-terminal-collapsed',
    height: 'auto',
  }),

  // Expanded state - shows full terminal
  expanded: css({
    label: 'coda-terminal-expanded',
  }),

  // Resize handle at the top
  resizeHandle: css({
    label: 'coda-terminal-resize-handle',
    height: 4,
    cursor: 'ns-resize',
    backgroundColor: 'transparent',
    transition: 'background-color 0.15s ease',
    flexShrink: 0,
    '&:hover': {
      backgroundColor: theme.colors.primary.main,
    },
    '&:active': {
      backgroundColor: theme.colors.primary.shade,
    },
  }),

  // Header bar with title and controls
  header: css({
    label: 'coda-terminal-header',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5, 1),
    padding: theme.spacing(0.5, 1),
    backgroundColor: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
    minHeight: 32,
  }),

  headerLeft: css({
    label: 'coda-terminal-header-left',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),

  title: css({
    label: 'coda-terminal-title',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
  }),

  connectionNotice: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),

  vmIdentity: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontFamily: theme.typography.fontFamilyMonospace,
    whiteSpace: 'nowrap',
  }),

  headerRight: css({
    label: 'coda-terminal-header-right',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginLeft: 'auto',
    flexWrap: 'wrap',
    '& > button': {
      position: 'relative',
    },
    '& > button + button::after': {
      content: '""',
      position: 'absolute',
      left: `calc(-${theme.spacing(0.25)} - 1px)`,
      top: '50%',
      transform: 'translateY(-50%)',
      height: theme.spacing(2),
      width: 1,
      backgroundColor: theme.colors.border.strong,
      pointerEvents: 'none',
    },
  }),

  // Status indicator
  statusIndicator: css({
    label: 'coda-terminal-status-indicator',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),

  expiryIndicator: css({
    label: 'coda-terminal-expiry-indicator',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.warning.text,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  }),

  statusDot: css({
    label: 'coda-terminal-status-dot',
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  }),

  statusConnected: css({
    backgroundColor: theme.colors.success.main,
  }),

  statusConnecting: css({
    backgroundColor: theme.colors.warning.main,
  }),

  statusDisconnected: css({
    backgroundColor: theme.colors.text.disabled,
  }),

  statusError: css({
    backgroundColor: theme.colors.error.main,
  }),

  // Terminal content area
  terminalWrapper: css({
    label: 'coda-terminal-wrapper',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    padding: theme.spacing(0.5),
    overflow: 'hidden',
    backgroundColor: '#1e1e1e',
    '& .xterm': {
      height: '100%',
    },
    '& .xterm-viewport': {
      overflowY: 'auto',
    },
  }),

  // Collapsed placeholder
  collapsedBar: css({
    label: 'coda-terminal-collapsed-bar',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5, 1),
    padding: theme.spacing(0.5, 1),
    backgroundColor: theme.colors.background.secondary,
    cursor: 'pointer',
    minHeight: 32,
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),

  // Button styles
  headerButton: css({
    label: 'coda-terminal-header-button',
    flexShrink: 0,
  }),

  // Search bar
  searchBar: css({
    label: 'coda-terminal-search-bar',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 1),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
  }),
});
