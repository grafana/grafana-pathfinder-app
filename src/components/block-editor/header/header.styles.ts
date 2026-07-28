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
  // Title row (top): editable title + status badge, above the toolbar row.
  titleRow: css({
    display: 'flex',
    alignItems: 'center',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)} 0`,
    gap: theme.spacing(1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  // Toolbar row (bottom): view-mode rocker on the left, action cluster on the
  // right. Single-line — never wraps. `containerType: inline-size` drives the
  // rocker's icon-only swap and the `saveButton` label/icon collapse, both
  // keyed off this row's width. Uniform vertical padding also gives preview mode
  // (where the title row is hidden and this row sits at the top) its top spacing.
  toolbarRow: css({
    display: 'flex',
    alignItems: 'center',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    gap: theme.spacing(0.5),
    flexWrap: 'nowrap',
    containerType: 'inline-size',
  }),
  // Right-aligned action cluster on the toolbar row.
  rightCluster: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginLeft: 'auto',
    flexShrink: 0,
  }),
  // Status cluster (publish badge, or local-save indicator when there's no
  // backend). `flexShrink: 0` + `nowrap` so a long title can't shrink or wrap
  // the badge in the title row — the title input absorbs the shrink instead.
  statusWrap: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexShrink: 0,
    whiteSpace: 'nowrap',
  }),
  // In preview the status cluster sits in the non-shrinking, no-wrap toolbar;
  // hide it below the collapse tier so a wide badge can't overflow the row.
  // Status still shows in edit/JSON and at wider preview widths.
  previewStatusWrap: css({
    '@container (max-width: 420px)': {
      display: 'none',
    },
  }),
  // Wraps the title input so it can carry a persistent gradient underline
  // (an <input> cannot host a ::after). The bar is always on — it marks the
  // editor as the active surface, mirroring the tab bar's `iconTabActive`.
  titleInputWrap: css({
    position: 'relative',
    display: 'inline-flex',
    minWidth: 0,
    maxWidth: '100%',
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 2,
      right: 2,
      bottom: 0,
      height: '2px',
      borderRadius: theme.shape.radius.default,
      backgroundImage: theme.colors.gradients.brandHorizontal,
    },
  }),
  guideTitleInput: css({
    background: 'transparent',
    border: 'none',
    color: theme.colors.text.primary,
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    fontFamily: theme.typography.fontFamily,
    padding: '0 2px',
    margin: 0,
    outline: 'none',
    minWidth: 0,
    maxWidth: '100%',
    '&:focus': {
      background: theme.colors.background.secondary,
    },
    // Keyboard focus indicator: the always-on gradient underline doesn't signal
    // focus and `outline: none` above removes the default (WCAG 2.4.7).
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.main}`,
      outlineOffset: 1,
    },
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
