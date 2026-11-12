import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export const getFullScreenStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    borderRadius: theme.shape.radius.lg,
    isolation: 'isolate',
    background: theme.colors.background.page,
  }),
  // Keep the header outside the reader's scroll area.
  stickyTopBar: css({
    flexShrink: 0,
    borderTopLeftRadius: theme.shape.radius.lg,
    borderTopRightRadius: theme.shape.radius.lg,
    overflow: 'clip',
    position: 'relative',
    zIndex: 1,
    background: theme.colors.background.primary,
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 0.75, 0.75, 1.25),
    minHeight: theme.spacing(5),
    boxSizing: 'border-box',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
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
    gap: theme.spacing(1),
    flexShrink: 0,
  }),
  body: css({
    flex: '1 1 0',
    overscrollBehavior: 'contain',
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
});
