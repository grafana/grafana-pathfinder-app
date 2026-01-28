/**
 * Block Editor Styles
 *
 * Theme-aware styles for the block-based JSON guide editor.
 */

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

/**
 * Main block editor container styles
 */
export const getBlockEditorStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: theme.colors.background.primary,
  }),

  // Header with title and controls
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(1.5),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.secondary,
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  }),

  headerLeft: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flex: 1,
    minWidth: 0,
  }),

  headerRight: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),

  viewModeToggle: css({
    marginRight: theme.spacing(1.5),
  }),

  guideTitle: css({
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),

  // Main content area
  content: css({
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: theme.spacing(2),
    // Ensure drag images aren't clipped
    contain: 'layout',
  }),

  // Empty state
  emptyState: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: '200px',
    gap: theme.spacing(2),
    color: theme.colors.text.secondary,
    textAlign: 'center',
  }),

  emptyStateIcon: css({
    fontSize: '48px',
    opacity: 0.5,
  }),

  emptyStateText: css({
    fontSize: theme.typography.body.fontSize,
    maxWidth: '300px',
  }),

  // Footer with add block button - entire area is clickable
  footer: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: theme.spacing(2),
    minHeight: '56px',
    border: `2px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    transition: 'all 0.2s ease',

    '&:hover': {
      borderColor: theme.colors.primary.border,
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),

  // Selection controls - shown above blocks in edit mode
  selectionControls: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75),
    marginBottom: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),

  selectionCount: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    paddingRight: theme.spacing(1),
    borderRight: `1px solid ${theme.colors.border.weak}`,
    marginRight: theme.spacing(0.5),
  }),
});

/**
 * Block palette styles (the + menu)
 */
export const getBlockPaletteStyles = (theme: GrafanaTheme2) => ({
  trigger: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    padding: theme.spacing(1.5),
    border: `2px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: 'transparent',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    transition: 'all 0.2s ease',

    '&:hover': {
      borderColor: theme.colors.primary.border,
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),

  triggerCompact: css({
    width: 'auto',
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    border: `1px dashed ${theme.colors.border.weak}`,
  }),

  menu: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    minWidth: '320px',
  }),

  menuItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.primary,
    cursor: 'pointer',
    transition: 'all 0.15s ease',

    '&:hover': {
      borderColor: theme.colors.primary.border,
      backgroundColor: theme.colors.action.hover,
      transform: 'translateY(-1px)',
    },
  }),

  menuItemIcon: css({
    fontSize: '20px',
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  }),

  menuItemContent: css({
    flex: 1,
    minWidth: 0,
  }),

  menuItemName: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(0.25),
  }),

  menuItemDescription: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
});

/**
 * Block list styles
 */
export const getBlockListStyles = (theme: GrafanaTheme2) => ({
  list: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5), // Tighter gap between blocks
  }),

  insertZone: css({
    height: '8px', // Fixed small height - never changes
    position: 'relative',
    // No padding or size changes on hover - prevents jitter
  }),

  insertZoneButton: css({
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    opacity: 0,
    transition: 'opacity 0.15s ease',
    zIndex: 10,
    pointerEvents: 'none',
  }),

  insertZoneButtonVisible: css({
    opacity: 1,
    pointerEvents: 'auto',
  }),

  // Active state during drag operations
  insertZoneActive: css({
    // Keep height fixed even during drag
  }),

  // Drag overlay for sections/conditionals with nested content
  dragOverlay: css({
    opacity: 0.95,
    cursor: 'grabbing',
    boxShadow: theme.shadows.z3,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.primary,
    border: `2px solid ${theme.colors.primary.main}`,
    maxHeight: '500px',
    overflow: 'hidden',
    pointerEvents: 'none',
  }),
});

/**
 * Block item styles
 */
export const getBlockItemStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    alignItems: 'stretch',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.primary,
    transition: 'all 0.15s ease',
    userSelect: 'none', // Prevent text selection during drag

    '&:hover': {
      borderColor: theme.colors.border.medium,
      boxShadow: theme.shadows.z1,
    },
  }),

  dragHandle: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    color: theme.colors.text.disabled,
    flexShrink: 0,
    pointerEvents: 'none', // Visual indicator only - parent handles dragging

    '&:hover': {
      color: theme.colors.text.secondary,
    },
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

  typeIcon: css({
    fontSize: '16px',
    flexShrink: 0,
  }),

  typeBadge: css({
    // No color override - let Badge component control colors for vibrancy
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

  recordButton: css({
    color: theme.colors.error.text,
    opacity: 0.7,
    transition: 'all 0.15s ease',

    '&:hover': {
      opacity: 1,
      backgroundColor: theme.colors.error.transparent,
    },
  }),

  recordingButton: css({
    color: theme.colors.error.text,
    backgroundColor: theme.colors.error.transparent,
    animation: 'pulse 1.5s ease-in-out infinite',
    transition: 'all 0.15s ease',

    '@keyframes pulse': {
      '0%, 100%': {
        opacity: 1,
      },
      '50%': {
        opacity: 0.5,
      },
    },

    '&:hover': {
      backgroundColor: theme.colors.error.shade,
      color: theme.colors.error.contrastText,
    },
  }),

  // Section-specific styles
  sectionContainer: css({
    // Sections look the same as other blocks - no special styling
  }),

  sectionChildren: css({
    marginLeft: theme.spacing(3),
    marginTop: theme.spacing(1),
    paddingLeft: theme.spacing(2),
    borderLeft: `2px solid ${theme.colors.border.medium}`,
  }),

  // Selection mode styles
  selectionCheckbox: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    flexShrink: 0,
    cursor: 'pointer',
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

  // Collapse button for sections/conditionals
  collapseButton: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: theme.spacing(0.5),
    color: theme.colors.text.secondary,
    transition: 'all 0.15s ease',

    '&:hover': {
      color: theme.colors.text.primary,
      backgroundColor: theme.colors.action.hover,
    },

    '& svg': {
      transition: 'transform 0.2s ease',
    },
  }),

  collapseButtonRotated: css({
    '& svg': {
      transform: 'rotate(-90deg)',
    },
  }),
});

/**
 * Block form modal styles
 */
export const getBlockFormStyles = (theme: GrafanaTheme2) => ({
  modal: css({
    maxWidth: '600px',
    width: '100%',
  }),

  form: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),

  section: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),

  sectionTitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: theme.spacing(0.5),
  }),

  row: css({
    display: 'flex',
    gap: theme.spacing(2),

    '& > *': {
      flex: 1,
    },
  }),

  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    paddingTop: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),

  footerLeft: css({
    display: 'flex',
    gap: theme.spacing(1),
    marginRight: 'auto',
  }),

  // DOM picker button
  selectorField: css({
    display: 'flex',
    gap: theme.spacing(1),
  }),

  selectorInput: css({
    flex: 1,
  }),

  // Code preview
  codePreview: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    backgroundColor: theme.colors.background.secondary,
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    overflow: 'auto',
    maxHeight: '200px',
  }),

  // Help text
  helpText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing(0.5),
  }),

  // Requirements quick-add chips
  requirementsContainer: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(-0.5), // Pull up closer to the field above
    marginBottom: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: `0 0 ${theme.shape.radius.default} ${theme.shape.radius.default}`,
    borderTop: 'none',
  }),

  requirementsLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),

  requirementsChips: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
  }),

  requirementChip: css({
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    opacity: 0.85,

    '&:hover': {
      opacity: 1,
      transform: 'scale(1.05)',
    },

    '&::before': {
      content: '"+"',
      marginRight: '2px',
      fontWeight: 600,
    },
  }),

  // Checkbox container - ensures left alignment
  checkbox: css({
    alignSelf: 'flex-start',
    textAlign: 'left',
  }),

  // Preview section for displaying parsed values
  previewSection: css({
    marginTop: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),

  previewLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(0.5),
    display: 'block',
  }),

  previewList: css({
    margin: 0,
    paddingLeft: theme.spacing(2),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,

    '& li': {
      marginBottom: theme.spacing(0.25),
      fontFamily: theme.typography.fontFamilyMonospace,
    },
  }),
});

/**
 * Preview panel styles
 */
export const getBlockPreviewStyles = (theme: GrafanaTheme2) => ({
  container: css({
    height: '100%',
    overflow: 'auto',
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.primary,
  }),

  previewHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(2),
    paddingBottom: theme.spacing(1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),

  previewTitle: css({
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
  }),

  previewBadge: css({
    marginLeft: theme.spacing(1),
  }),
});

/**
 * Guide metadata form styles
 */
export const getGuideMetadataStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),

  row: css({
    display: 'flex',
    gap: theme.spacing(2),

    '& > *': {
      flex: 1,
    },
  }),

  tagsInput: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
    alignItems: 'center',
  }),
});
