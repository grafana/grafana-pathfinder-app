/**
 * BlockList Styles
 *
 * Theme-aware styles for BlockList component and its sub-components.
 * Note: Drop indicator styles have been moved inline to BlockList.tsx
 * as part of the @dnd-kit migration.
 */

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

/**
 * Styles for nested blocks within sections
 */
export const getNestedStyles = (theme: GrafanaTheme2) => ({
  nestedContainer: css({
    marginLeft: theme.spacing(3),
    paddingLeft: theme.spacing(2),
    borderLeft: `3px solid ${theme.colors.primary.border}`,
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
    backgroundColor: theme.isDark ? 'rgba(74, 144, 226, 0.03)' : 'rgba(74, 144, 226, 0.02)',
    borderRadius: `0 ${theme.shape.radius.default} ${theme.shape.radius.default} 0`,
    overflow: 'hidden',
    transition: 'max-height 0.2s ease-out, opacity 0.2s ease-out, padding 0.2s ease-out',
  }),
  nestedContainerCollapsed: css({
    maxHeight: '0 !important',
    padding: '0 !important',
    marginTop: '0 !important',
    marginBottom: '0 !important',
    opacity: 0,
    overflow: 'hidden',
  }),
  dropZone: css({
    minHeight: '56px',
    border: `2px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    marginTop: theme.spacing(1),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',

    '&:hover': {
      borderColor: theme.colors.primary.border,
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),
  dropZoneActive: css({
    borderColor: theme.colors.primary.main,
    backgroundColor: theme.colors.primary.transparent,
    color: theme.colors.primary.text,
    minHeight: '60px',
    border: `3px solid ${theme.colors.primary.main}`,
    boxShadow: `0 0 12px ${theme.colors.primary.transparent}`,
  }),
  nestedBlockItem: css({
    marginBottom: theme.spacing(1),
  }),
  emptySection: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
  }),
  dragOverlay: css({
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  dragInstructions: css({
    padding: theme.spacing(2, 4),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.text.primary,
  }),
});

/**
 * Styles for conditional block branches
 */
export const getConditionalStyles = (theme: GrafanaTheme2) => ({
  conditionalContainer: css({
    marginLeft: theme.spacing(3),
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
    overflow: 'hidden',
    transition: 'max-height 0.2s ease-out, opacity 0.2s ease-out',
  }),
  conditionalContainerCollapsed: css({
    maxHeight: '0 !important',
    marginTop: '0 !important',
    marginBottom: '0 !important',
    opacity: 0,
    overflow: 'hidden',
  }),
  branchContainer: css({
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    marginBottom: theme.spacing(1),
  }),
  trueBranch: css({
    borderLeft: `3px solid ${theme.colors.success.border}`,
    backgroundColor: theme.isDark ? 'rgba(34, 166, 113, 0.05)' : 'rgba(34, 166, 113, 0.03)',
    paddingLeft: theme.spacing(2),
  }),
  falseBranch: css({
    borderLeft: `3px solid ${theme.colors.warning.border}`,
    backgroundColor: theme.isDark ? 'rgba(255, 152, 48, 0.05)' : 'rgba(255, 152, 48, 0.03)',
    paddingLeft: theme.spacing(2),
  }),
  branchHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  branchHeaderTrue: css({
    color: theme.colors.success.text,
  }),
  branchHeaderFalse: css({
    color: theme.colors.warning.text,
  }),
  branchIcon: css({
    fontSize: '14px',
  }),
  emptyBranch: css({
    padding: theme.spacing(1.5),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  conditionsBadge: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(1),
    fontFamily: theme.typography.fontFamilyMonospace,
    padding: theme.spacing(0.5, 1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    display: 'inline-block',
  }),
  recordButton: css({
    marginLeft: 'auto',
    color: theme.colors.text.secondary,
    '&:hover': {
      color: theme.colors.error.text,
    },
  }),
  recordingButton: css({
    marginLeft: 'auto',
    color: theme.colors.error.main,
    animation: 'pulse 1s ease-in-out infinite',
  }),
});

/**
 * Styles for nested block items - matches root BlockItem styling
 */
export const getNestedBlockItemStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.15s ease',
    minHeight: '52px',

    '&:hover': {
      borderColor: theme.colors.border.medium,
      boxShadow: theme.shadows.z1,
    },
  }),
  selectedContainer: css({
    borderColor: theme.colors.primary.border,
    backgroundColor: theme.colors.primary.transparent,
    boxShadow: `0 0 0 1px ${theme.colors.primary.border}`,
  }),
  // Just-dropped highlight animation
  justDroppedContainer: css({
    animation: 'dropHighlight 1.5s ease-out',
    '@keyframes dropHighlight': {
      '0%': {
        borderColor: theme.colors.primary.main,
        boxShadow: `0 0 0 3px ${theme.colors.primary.transparent}, 0 0 8px ${theme.colors.primary.main}`,
      },
      '100%': {
        borderColor: theme.colors.border.weak,
        boxShadow: 'none',
      },
    },
  }),
  // Persistent highlight for the last modified block
  lastModifiedContainer: css({
    borderColor: theme.colors.warning.border,
    boxShadow: `0 0 0 2px ${theme.colors.warning.transparent}`,
  }),
  // Block sequence number badge
  blockNumber: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '20px',
    height: '20px',
    padding: `0 ${theme.spacing(0.5)}`,
    borderRadius: '10px',
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
  }),
  selectionCheckbox: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    flexShrink: 0,
    cursor: 'pointer',
  }),
  dragHandle: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    color: theme.colors.text.disabled,
    flexShrink: 0,
    pointerEvents: 'none', // Don't block drag events - parent handles dragging
  }),
  content: css({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  icon: css({
    fontSize: '16px',
    flexShrink: 0,
  }),
  preview: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  actions: css({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(1.5),
    flexShrink: 0,
    padding: theme.spacing(0.5),
  }),
  actionGroup: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  actionButton: css({
    opacity: 0.7,
    transition: 'all 0.15s ease',

    '&:hover': {
      opacity: 1,
      backgroundColor: theme.colors.action.hover,
    },
  }),
  editButton: css({
    color: theme.colors.primary.text,
    backgroundColor: theme.colors.primary.transparent,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.15s ease',

    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      color: theme.colors.primary.contrastText,
    },
  }),
  deleteButton: css({
    opacity: 0.7,
    color: theme.colors.error.text,
    transition: 'all 0.15s ease',

    '&:hover': {
      opacity: 1,
      backgroundColor: theme.colors.error.transparent,
    },
  }),
});
