import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getContainerStyles = (theme: GrafanaTheme2) => ({
  container: css({
    label: 'context-container',
    borderRadius: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    margin: 0,
    height: '100%',
    width: '100%',
  }),
  content: css({
    label: 'context-content',
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  }),
  contextSections: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
  }),
});

// Loading and state styles
export const getStateStyles = (theme: GrafanaTheme2) => ({
  loadingContainer: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    justifyContent: 'center',
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    margin: theme.spacing(1),
  }),
});

// Recommendation card styles
export const getRecommendationCardStyles = (theme: GrafanaTheme2) => ({
  compactCard: css({
    // Keep compact but balanced
    padding: theme.spacing(1),
    minHeight: '70px', // Much smaller for docs pages
  }),
  recommendationCardContent: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    width: '100%',
    maxWidth: '100%',
    height: '100%',
  }),
  compactCardContent: css({
    gap: theme.spacing(0.75), // Tighter spacing for docs pages
  }),
  cardHeader: css({
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    width: '100%',
    maxWidth: '100%',
    marginBottom: theme.spacing(1),
  }),
  compactHeader: css({
    marginBottom: theme.spacing(0.5), // Reduced bottom margin for docs pages
    alignItems: 'center', // Center align for cleaner look
  }),
  cardTitleSection: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    flex: 1,
    minWidth: 0,
    maxWidth: 'calc(100% - 100px)',
  }),
  cardTagRow: css({
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
  }),
  recommendationCardTitle: css({
    margin: 0,
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    lineHeight: 1.3,
    wordBreak: 'break-word',
    display: '-webkit-box',
    '-webkit-line-clamp': '2',
    '-webkit-box-orient': 'vertical',
    overflow: 'hidden',
  }),
  // Category tag base styles - shared by all tag variants
  categoryTagBase: css({
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: theme.typography.fontWeightMedium,
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    width: 'fit-content',
    lineHeight: 1.4,
  }),
  // Interactive guide tag - orange color (action-oriented)
  categoryTagInteractive: css({
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: '11px',
    fontWeight: theme.typography.fontWeightMedium,
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    width: 'fit-content',
    lineHeight: 1.4,
    backgroundColor: theme.isDark ? 'rgba(255, 152, 48, 0.15)' : 'rgba(255, 152, 48, 0.15)',
    border: `1px solid ${theme.isDark ? 'rgba(255, 152, 48, 0.25)' : 'rgba(255, 152, 48, 0.25)'}`,
    color: theme.isDark ? '#ffb366' : '#b35c00',
  }),
  packagePillIcon: css({
    display: 'inline-block',
    fontSize: '10px',
    lineHeight: 1,
    marginRight: theme.spacing(0.5),
  }),
  // Learning journey tag - purple color (exploration)
  categoryTagJourney: css({
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: theme.typography.fontWeightMedium,
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    width: 'fit-content',
    lineHeight: 1.4,
    backgroundColor: theme.isDark ? 'rgba(138, 43, 226, 0.15)' : 'rgba(138, 43, 226, 0.15)',
    border: `1px solid ${theme.isDark ? 'rgba(138, 43, 226, 0.25)' : 'rgba(138, 43, 226, 0.25)'}`,
    color: theme.isDark ? '#b380e0' : '#6b21a8',
  }),
  // Docs page tag - blue color (informational)
  categoryTagDocs: css({
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: theme.typography.fontWeightMedium,
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    width: 'fit-content',
    lineHeight: 1.4,
    backgroundColor: theme.isDark ? 'rgba(110, 159, 255, 0.15)' : 'rgba(110, 159, 255, 0.15)',
    border: `1px solid ${theme.isDark ? 'rgba(110, 159, 255, 0.25)' : 'rgba(110, 159, 255, 0.25)'}`,
    color: theme.isDark ? '#8ab8ff' : '#1f62c0',
  }),
  cardActions: css({
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'flex-end',
    flexShrink: 0,
    width: '80px',
  }),
  startButton: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
    whiteSpace: 'nowrap',
    minWidth: '80px',
    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      boxShadow: theme.shadows.z1,
    },
  }),
  // Secondary button style for "View" actions
  secondaryButton: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
    backgroundColor: theme.colors.background.primary,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
    whiteSpace: 'nowrap',
    minWidth: '80px',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.strong,
      boxShadow: theme.shadows.z1,
    },
  }),
});

// Card metadata and interaction styles
export const getCardMetadataStyles = (theme: GrafanaTheme2) => ({
  cardMetadata: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.spacing(0.5),
    borderTop: `1px solid ${theme.colors.border.medium}`,
  }),
  stepsInfo: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    width: '100%',
  }),
  summaryInfo: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    width: '100%',
  }),
  completionInfo: css({
    display: 'flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginLeft: 'auto',
  }),
  completionPercentage: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.success.main,
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.default,
    whiteSpace: 'nowrap',

    // Special styling for 0% completion (not started)
    '&[data-completion="0"]': {
      color: theme.colors.text.secondary,
    },
  }),
  inlineSummary: css({
    flex: 1,
    margin: 0,
    padding: `${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightRegular,
    lineHeight: 1.4,
    color: theme.colors.text.primary,
  }),
  stepsCount: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    color: theme.colors.text.primary,
    backgroundColor: theme.colors.background.secondary,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  viewStepsButton: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    backgroundColor: 'transparent',
    border: 'none',
    padding: theme.spacing(0.25),
    cursor: 'pointer',
    color: theme.colors.text.link,
    fontSize: theme.typography.bodySmall.fontSize,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.2s ease',
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.action.hover,
      textDecoration: 'none',
    },
    '&:disabled': {
      opacity: 0.6,
      cursor: 'not-allowed',
    },
  }),
});

// Summary and content expansion styles
export const getSummaryStyles = (theme: GrafanaTheme2) => ({
  summaryExpansion: css({
    padding: theme.spacing(0.5),
    paddingLeft: theme.spacing(3),
    position: 'relative',
  }),
  summaryContent: css({
    marginBottom: theme.spacing(2),
  }),
  summaryText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    lineHeight: 1.4,
    margin: 0,
  }),
});

// Milestone and steps styles
export const getMilestoneStyles = (theme: GrafanaTheme2) => ({
  milestonesSection: css({
    paddingTop: theme.spacing(1.5),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  milestonesHeader: css({
    marginBottom: theme.spacing(1),
  }),
  milestonesTitle: css({
    margin: 0,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  milestonesList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  milestoneItem: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75),
    borderRadius: theme.shape.radius.default,
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
    width: '100%',
    textAlign: 'left',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),
  milestoneNumber: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    borderRadius: '50%',
    fontSize: '11px',
    fontWeight: theme.typography.fontWeightBold,
    flexShrink: 0,
  }),
  milestoneContent: css({
    flex: 1,
    minWidth: 0,
  }),
  milestoneTitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    lineHeight: 1.3,
  }),
  milestoneDuration: css({
    fontSize: '10px',
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    fontWeight: theme.typography.fontWeightRegular,
    marginLeft: theme.spacing(0.5),
  }),
  // A member referenced by a path/journey manifest that hasn't resolved yet
  // (not yet published, or a transient error) — visibly present but inert,
  // rather than silently missing from the list (RFC CUSTOM-GUIDE-PACKAGES.md §6.5).
  milestoneItemLocked: css({
    cursor: 'not-allowed',
    opacity: 0.55,
    '&:hover': {
      backgroundColor: 'transparent',
    },
  }),
});

// Skeleton placeholders shown while deferred milestones/nav links resolve
export const getDeferredSkeletonStyles = (theme: GrafanaTheme2) => ({
  deferredSkeleton: css({
    paddingTop: theme.spacing(1.5),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  deferredSkeletonRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75),
  }),
  deferredSkeletonCircle: css({
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    flexShrink: 0,
  }),
  deferredSkeletonBar: css({
    height: '14px',
    flex: 1,
    maxWidth: '70%',
    borderRadius: theme.shape.radius.default,
  }),
});

// Steps section styles (for step-by-step expansion)
export const getStepsStyles = (theme: GrafanaTheme2) => ({
  stepsSection: css({
    paddingTop: theme.spacing(1.5),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  stepsExpansion: css({
    marginTop: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  stepsList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  }),
  stepItem: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5),
    borderRadius: theme.shape.radius.default,
    transition: 'background-color 0.2s ease',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),
  stepNumber: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    borderRadius: '50%',
    fontSize: '11px',
    fontWeight: theme.typography.fontWeightBold,
    flexShrink: 0,
  }),
  stepContent: css({
    flex: 1,
    minWidth: 0,
  }),
  stepTitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(0.25),
    lineHeight: 1.3,
  }),
  stepDuration: css({
    fontSize: '11px',
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
  }),
});

// Debug section styles
export const getDebugStyles = (theme: GrafanaTheme2) => ({
  debugSection: css({
    marginTop: theme.spacing(4),
    padding: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.secondary,
  }),
});

// Main export combining all styles
export const getStyles = (theme: GrafanaTheme2) => ({
  ...getContainerStyles(theme),
  ...getStateStyles(theme),
  ...getRecommendationCardStyles(theme),
  ...getCardMetadataStyles(theme),
  ...getSummaryStyles(theme),
  ...getMilestoneStyles(theme),
  ...getDeferredSkeletonStyles(theme),
  ...getStepsStyles(theme),
  ...getDebugStyles(theme),
});
