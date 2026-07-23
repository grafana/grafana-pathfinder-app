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
  // Single-row toolbar: title (flex 1) + actions cluster on the right.
  // `containerType: inline-size` lets the per-button `@container` rule in
  // `collapsibleLabel` collapse button labels to icon-only when the row gets
  // narrow. Wraps to a second line when the cluster still doesn't fit.
  row: css({
    display: 'flex',
    alignItems: 'center',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    gap: theme.spacing(1),
    flexWrap: 'wrap',
    containerType: 'inline-size',
  }),
  // Title is guaranteed at least ~180px so the actions cluster has to wrap
  // to a new row when the row gets narrow, instead of crushing the title to
  // zero. The input inside still keeps `minWidth: 0 + flex: 1` so long
  // titles ellipsis within the reserved 180px rather than overflowing.
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
  // Right-side action cluster.
  // - `marginLeft: auto` pushes the cluster to the right edge of the row,
  //   and — when the cluster wraps onto its own line — keeps it right-aligned
  //   on that line as well.
  // - `flexWrap` + `rowGap` let the buttons inside the cluster spill onto a
  //   second line once even the icon-only collapse can't keep them on one row.
  // - Label collapse below 640px is opt-in via the `collapsibleLabel` class
  //   on each Button that wants it (rather than a broad `& button > span`
  //   rule scoped to the whole cluster). That avoids accidentally hiding
  //   spans nested inside Badges, IconButtons, or future Grafana `Button`
  //   internals that might add their own child `<span>`s.
  actions: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(0.5),
    flexShrink: 0,
    flexWrap: 'wrap',
    rowGap: theme.spacing(0.5),
    marginLeft: 'auto',
  }),
  // Opt-in collapse for Grafana `Button` components that carry a text label.
  // Under 640px we hide Button's content `<span>` (its direct child) and
  // tighten horizontal padding, leaving the icon visible. Tooltips and
  // aria-labels carry the meaning. Targets `& > span` so it only affects
  // the labeled span that Grafana renders as a direct child of the
  // `<button>` element this class is applied to — never any descendants.
  // Container query fires off `row`'s `containerType: inline-size`.
  collapsibleLabel: css({
    '@container (max-width: 640px)': {
      paddingLeft: theme.spacing(0.75),
      paddingRight: theme.spacing(0.75),
      '& > span': {
        display: 'none',
      },
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
  divider: css({
    width: '1px',
    height: '20px',
    backgroundColor: theme.colors.border.weak,
    margin: `0 ${theme.spacing(0.25)}`,
    flexShrink: 0,
  }),
  moreButton: css({
    '& > button': {
      padding: '4px 8px',
    },
  }),
});
