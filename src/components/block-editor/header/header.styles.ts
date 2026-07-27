import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getHeaderStyles = (theme: GrafanaTheme2) => ({
  // Sticky so the toolbar stays pinned to the top of the editor's scroll
  // container — same belt-and-braces approach used by the fullscreen layout
  // (`full-screen.styles.ts:stickyTopBar`). `flexShrink: 0` keeps it from
  // collapsing inside a flex parent.
  header: css({
    display: 'flex',
    flexDirection: 'column',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.primary,
    position: 'sticky',
    top: 0,
    zIndex: theme.zIndex.navbarFixed,
    flexShrink: 0,
  }),
  // Title row (top): editable title + guide id, then status/badge on the right.
  titleRow: css({
    display: 'flex',
    alignItems: 'center',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)} ${theme.spacing(0.5)}`,
    gap: theme.spacing(1),
  }),
  // Toolbar row (bottom): view-mode rocker on the left, action cluster on the
  // right. Single-line — never wraps. `containerType: inline-size` drives the
  // rocker's icon-only swap and the `saveButton` label/icon collapse, both
  // keyed off this row's width.
  toolbarRow: css({
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${theme.spacing(1.5)} ${theme.spacing(1)}`,
    gap: theme.spacing(0.5),
    flexWrap: 'nowrap',
    containerType: 'inline-size',
  }),
  // Right-aligned cluster (used on both rows).
  rightCluster: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginLeft: 'auto',
    flexShrink: 0,
  }),
  // Reserves ~180px min and grows to fill the title row. The input inside keeps
  // `minWidth: 0 + flex: 1` so long titles ellipsis within the reserved space
  // rather than overflowing.
  titleArea: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 180,
    flex: '1 1 180px',
    '&:hover .guide-id': {
      opacity: 1,
    },
  }),
  guideTitleInput: css({
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid transparent`,
    borderRadius: 0,
    color: theme.colors.text.primary,
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    fontFamily: theme.typography.fontFamily,
    padding: '0 2px',
    margin: 0,
    outline: 'none',
    minWidth: 0,
    flex: 1,
    '&:hover': {
      borderBottomColor: theme.colors.border.medium,
    },
    '&:focus': {
      borderBottomColor: theme.colors.primary.main,
      background: theme.colors.background.secondary,
    },
  }),
  guideId: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    opacity: 0,
    transition: 'opacity 0.15s',
    padding: '0 2px',
    flexShrink: 0,
  }),
  // Save/publish button: label-only at full width, icon-only once the toolbar
  // collapses below 420px (mirrors the rocker's collapse). Grafana's Button
  // renders the icon as its only `<svg>` and the label as a direct-child
  // `<span>`, so we toggle those directly. Container query fires off
  // `toolbarRow`'s `containerType: inline-size`; the aria-label carries the
  // action name when the label is hidden.
  saveButton: css({
    // Full width: show the label, hide the icon glyph.
    '& svg': {
      display: 'none',
    },
    '@container (max-width: 420px)': {
      // Collapsed: icon-only — show the icon, hide the label, tighten padding.
      paddingLeft: theme.spacing(0.75),
      paddingRight: theme.spacing(0.75),
      '& svg': {
        display: 'inline-block',
      },
      '& > span': {
        display: 'none',
      },
    },
  }),
  // View-mode rocker wrapper: holds the labeled + icon-only RadioButtonGroups
  // and carries the viewModeToggle testid (the tour anchors on it). Exactly one
  // group is visible at a time — see the two classes below.
  viewModeRocker: css({
    display: 'inline-flex',
    alignItems: 'center',
  }),
  // Labeled group is the default; it collapses to the icon-only sibling below
  // the toolbar's collapse breakpoint. The `@container` rule fires off
  // `toolbarRow`'s `containerType: inline-size`.
  viewModeRockerLabeled: css({
    '@container (max-width: 420px)': {
      display: 'none',
    },
  }),
  // Icon-only fallback: hidden until the toolbar is too narrow for labels.
  viewModeRockerIconOnly: css({
    display: 'none',
    '@container (max-width: 420px)': {
      display: 'inline-flex',
    },
  }),
  // Subtler "Saved" indicator (replaces the green chip) — small floppy
  // `save` icon. Tooltip preserved for context.
  savedIndicator: css({
    display: 'inline-flex',
    alignItems: 'center',
    color: theme.colors.success.text,
    flexShrink: 0,
  }),
  savingIndicator: css({
    display: 'inline-flex',
    alignItems: 'center',
    color: theme.colors.warning.text,
    flexShrink: 0,
  }),
  moreButton: css({
    '& > button': {
      padding: '4px 8px',
    },
  }),
});
