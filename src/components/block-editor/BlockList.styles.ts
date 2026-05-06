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
    // Sidebar-tight indent: drop the 24px marginLeft, keep a slim
    // border-left as the only nesting indicator (10px paddingLeft).
    marginLeft: 0,
    paddingLeft: theme.spacing(1.25),
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
  // Inline "+ Add block" affordance for sections / conditional
  // branches. Matches the height of block cards (40px) so the rhythm
  // of the list stays consistent. Brightens to full strength on hover
  // or while dragging (`dropZoneActive`).
  dropZone: css({
    minHeight: '40px',
    border: `1px dashed ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: 'transparent',
    color: theme.colors.text.secondary,
    opacity: 0.6,
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    marginTop: theme.spacing(0.25),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',

    '&:hover': {
      opacity: 1,
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
    opacity: 1,
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
    // Match nested section indent: dropped 24px marginLeft.
    marginLeft: 0,
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
    paddingLeft: theme.spacing(1.25),
  }),
  falseBranch: css({
    borderLeft: `3px solid ${theme.colors.warning.border}`,
    backgroundColor: theme.isDark ? 'rgba(255, 152, 48, 0.05)' : 'rgba(255, 152, 48, 0.03)',
    paddingLeft: theme.spacing(1.25),
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
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.75),
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.15s ease',
    minHeight: '40px',

    '&:hover': {
      borderColor: theme.colors.border.medium,
      boxShadow: theme.shadows.z1,
    },
    // Mirror BlockItem: hover/focus reveals drag handle and secondary
    // actions via data-attribute selectors.
    '&:hover [data-drag-handle], &:focus-within [data-drag-handle]': {
      opacity: 1,
    },
    '&:hover [data-secondary-actions], &:focus-within [data-secondary-actions]': {
      opacity: 1,
      pointerEvents: 'auto',
    },
  }),
  // Nested blocks live inside `nestedContainer` which has
  // `overflow: hidden` (required for the section's collapse animation).
  // Outset shadows would get clipped on the top of the first child and
  // the right edge of every child, so all selection / drop / modified
  // emphasis is drawn with INSET shadows here.
  selectedContainer: css({
    borderColor: theme.colors.primary.border,
    backgroundColor: theme.colors.primary.transparent,
    boxShadow: `inset 0 0 0 1px ${theme.colors.primary.border}`,
  }),
  // Just-dropped highlight animation
  justDroppedContainer: css({
    animation: 'dropHighlightNested 1.5s ease-out',
    '@keyframes dropHighlightNested': {
      '0%': {
        borderColor: theme.colors.primary.main,
        boxShadow: `inset 0 0 0 3px ${theme.colors.primary.transparent}`,
      },
      '100%': {
        borderColor: theme.colors.border.weak,
        boxShadow: 'inset 0 0 0 0 transparent',
      },
    },
  }),
  // Persistent highlight for the last modified block
  lastModifiedContainer: css({
    borderColor: theme.colors.warning.border,
    boxShadow: `inset 0 0 0 2px ${theme.colors.warning.transparent}`,
  }),
  // Block sequence number — matches BlockItem's borderless quiet style.
  blockNumber: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '16px',
    height: '16px',
    fontSize: '11px',
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
    width: '16px',
    color: theme.colors.text.disabled,
    opacity: 0.4,
    transition: 'opacity 0.15s ease',
    flexShrink: 0,
    pointerEvents: 'none', // Don't block drag events - parent handles dragging
  }),
  content: css({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
  }),
  // Single inline row mirroring BlockItem.header.
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    minWidth: 0,
    flex: 1,
  }),
  icon: css({
    fontSize: '16px',
    flexShrink: 0,
  }),
  sectionTitle: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    flex: 1,
  }),
  headlinePreview: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    flex: 1,
  }),
  actions: css({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(0.25),
    flexShrink: 0,
  }),
  actionGroup: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
  }),
  secondaryActions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    opacity: 0,
    pointerEvents: 'none',
    transition: 'opacity 0.15s ease',
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
