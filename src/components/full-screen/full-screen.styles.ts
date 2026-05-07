import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export const getFullScreenStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    minHeight: 0,
    background: theme.colors.background.primary,
  }),
  // Pinned bar wrapping the header + optional subHeader so both stay
  // visible as a single block while the user scrolls a long milestone
  // body. In the happy path `.body` owns the scroll and this wrapper
  // doesn't actually move; the sticky positioning is belt-and-braces
  // for the cases where Grafana's `PageLayoutType.Custom` chain
  // doesn't fully constrain height to the viewport and document-level
  // scroll kicks in — without sticky, the user loses the dock-back
  // affordance mid-journey.
  stickyTopBar: css({
    flexShrink: 0,
    position: 'sticky',
    top: 0,
    zIndex: theme.zIndex.navbarFixed,
    background: theme.colors.background.primary,
  }),
  // Compact header that mirrors the floating panel's chrome — small
  // padding, body-small typography, icon-only actions. Avoids a "second
  // page-header" feel stacked under Grafana's own navbar.
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    flexShrink: 0,
  }),
  headerTitle: css({
    flex: 1,
    minWidth: 0,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  stepCounter: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    padding: theme.spacing(0.25, 1),
    background: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    flexShrink: 0,
  }),
  headerActions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    flexShrink: 0,
  }),
  body: css({
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    justifyContent: 'center',
  }),
  // Constrain prose width so long lines don't span ultra-wide displays.
  // The interactive engine queries for [data-pathfinder-content] so the
  // attribute is preserved at the inner wrapper, not the scroll container.
  contentWrap: css({
    width: '100%',
    maxWidth: 1100,
    padding: theme.spacing(3, 4),
  }),
  emptyState: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.body.fontSize,
  }),
  // Open / Reset guide action buttons inside the journey sub-header.
  // Visual parity with the sidebar's secondaryActionButton.
  secondaryActionButton: css({
    backgroundColor: 'transparent',
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    padding: `${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.strong,
      boxShadow: theme.shadows.z1,
    },
    '& svg': {
      width: '12px',
      height: '12px',
      flexShrink: 0,
    },
    // Container query mirroring the sidebar's `secondaryActionButton`:
    // the button collapses to icon-only when its parent toolbar
    // (`milestoneActions` from `getMilestoneStyles`, which declares
    // `containerType: inline-size`) gets too narrow. Same threshold so
    // sidebar and full-screen flip together at the same breakpoint.
    '@container (max-width: 360px)': {
      padding: theme.spacing(0.5),
      '& > span': {
        display: 'none',
      },
    },
  }),
});
