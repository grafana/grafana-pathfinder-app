import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { getGuideContentPadding } from '../../styles/content-html.styles';

const GUIDE_COLUMN_MAX_WIDTH = 1100;
const FULL_SCREEN_CONTENT_GUTTER = 4;

export const getFullScreenStyles = (theme: GrafanaTheme2, isCourseOverview: boolean, hasCourseLesson: boolean) => ({
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
  subHeader: css({
    background: theme.colors.background.page,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
    scrollbarGutter: 'stable',
  }),
  subHeaderContent: css({
    width: '100%',
    maxWidth: GUIDE_COLUMN_MAX_WIDTH,
    boxSizing: 'border-box',
    marginInline: 'auto',
    paddingInline: `calc(${theme.spacing(FULL_SCREEN_CONTENT_GUTTER)} + ${getGuideContentPadding(theme)})`,
  }),
  body: css({
    flex: '1 1 0',
    overscrollBehavior: 'contain',
    minHeight: 0,
    overflow: 'auto',
    scrollbarGutter: hasCourseLesson ? 'stable' : undefined,
    display: 'flex',
    justifyContent: 'center',
  }),
  // Constrain prose width so long lines don't span ultra-wide displays.
  // The interactive engine queries for [data-pathfinder-content] so the
  // attribute is preserved at the inner wrapper, not the scroll container.
  contentWrap: css({
    width: '100%',
    maxWidth: isCourseOverview ? 1160 : GUIDE_COLUMN_MAX_WIDTH,
    boxSizing: hasCourseLesson ? 'border-box' : undefined,
    alignSelf: isCourseOverview ? 'flex-start' : undefined,
    padding: theme.spacing(hasCourseLesson ? 2 : 3, FULL_SCREEN_CONTENT_GUTTER, 3),
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
