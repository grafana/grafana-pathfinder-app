import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

// Global modal styles for image lightbox functionality
export const addGlobalModalStyles = () => {
  const modalStyleId = 'journey-modal-styles';

  // Check if styles already exist
  if (document.getElementById(modalStyleId)) {
    return;
  }

  const style = document.createElement('style');
  style.id = modalStyleId;
  style.textContent = `
    /* Image Modal Styles */
    .journey-image-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .journey-image-modal-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .journey-image-modal-container {
      border-radius: 8px;
      overflow: hidden;
      max-width: 95vw;
      max-height: 95vh;
      position: relative;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
    }
    
    .journey-image-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      flex-shrink: 0;
    }
    
    .journey-image-modal-title {
      margin: 0;
      font-size: 16px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: calc(100% - 40px);
    }
    
    .journey-image-modal-close {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      transition: all 0.2s ease;
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .journey-image-modal-close:hover {
      opacity: 0.7;
    }
    
    .journey-image-modal-content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow: hidden;
      min-height: 0;
    }
    
    .journey-image-modal-image {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: all 0.3s ease;
    }
  `;

  document.head.appendChild(style);
};

export const getContainerStyles = (theme: GrafanaTheme2) => ({
  container: css({
    label: 'combined-journey-container',
    backgroundColor: theme.colors.background.primary,
    borderRadius: '0',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden', // Keep container contained
    margin: 0,
    height: '100%',
    width: '100%',
  }),
  content: css({
    label: 'combined-journey-content',
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  }),
  loadingContainer: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(2),
    justifyContent: 'center',
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    margin: theme.spacing(2),
  }),
});

export const getTopBarStyles = (theme: GrafanaTheme2) => ({
  topBar: css({
    label: 'combined-journey-top-bar',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.canvas,
  }),

  liveSessionButtons: css({
    label: 'live-session-buttons',
    display: 'flex',
    flexDirection: 'row',
    gap: theme.spacing(1),
    padding: `0 ${theme.spacing(1)}`,
    alignItems: 'center',
  }),
  title: css({
    label: 'combined-journey-title',
    flex: 1,
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    fontWeight: theme.typography.fontWeightBold,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
  }),
  appIcon: css({
    label: 'combined-journey-icon',
    fontSize: '7px',
    color: theme.colors.text.primary,
    letterSpacing: '0.1em',
    opacity: 0.75,
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  titleContent: css({
    label: 'combined-journey-title-content',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  titleText: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  actions: css({
    label: 'combined-journey-actions',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
  }),
});

export const getTabStyles = (theme: GrafanaTheme2) => ({
  tabBar: css({
    label: 'combined-journey-tab-bar',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing(0.5, 1),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    overflow: 'visible', // Allow dropdown to extend below tab bar
    position: 'relative', // Positioning context for absolute dropdown
    flex: 1, // Take full width of parent container
    minWidth: 0, // Allow shrinking
    // Smooth slide-down animation when tab bar appears
    animation: 'slideDown 0.3s ease-out',
    '@keyframes slideDown': {
      from: {
        maxHeight: 0,
        opacity: 0,
        transform: 'translateY(-8px)',
      },
      to: {
        maxHeight: '60px',
        opacity: 1,
        transform: 'translateY(0)',
      },
    },
  }),
  tabList: css({
    label: 'combined-journey-tab-list',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    overflow: 'hidden', // Hide overflowing tabs (dropdown is now outside)
    flex: 1,
    minWidth: 0, // Allow flex shrinking
  }),
  // Permanent icon-only tabs (Recommendations, My Learning)
  permanentTabs: css({
    label: 'combined-journey-permanent-tabs',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexShrink: 0,
  }),
  iconTab: css({
    label: 'combined-journey-icon-tab',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    padding: 0,
    borderRadius: theme.shape.radius.default,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: theme.colors.text.secondary,
    transition: 'all 0.2s ease',
    position: 'relative',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
    '& svg': {
      width: 18,
      height: 18,
    },
  }),
  iconTabActive: css({
    label: 'combined-journey-icon-tab-active',
    backgroundColor: theme.colors.action.selected,
    color: theme.colors.text.primary,
    // Active indicator bar at bottom
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 4,
      right: 4,
      bottom: 0,
      height: '2px',
      borderRadius: theme.shape.radius.default,
      backgroundImage: theme.colors.gradients.brandHorizontal,
    },
  }),
  tabDivider: css({
    label: 'combined-journey-tab-divider',
    width: 1,
    height: 20,
    backgroundColor: theme.colors.border.weak,
    margin: `0 ${theme.spacing(0.5)}`,
    flexShrink: 0,
  }),
  tab: css({
    label: 'combined-journey-tab',
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(0.75, 1.25),
    cursor: 'pointer',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 0,
    // Flexible width that respects container bounds
    flex: '1 1 80px',
    minWidth: 0, // Allow flex shrinking below content size
    maxWidth: '220px', // Still cap maximum width for aesthetics
    position: 'relative',
    transition: 'all 0.2s ease',
    color: theme.colors.text.secondary,
    overflow: 'hidden', // Prevent content overflow
    '&:hover': {
      backgroundColor: 'transparent',
      color: theme.colors.text.primary,
      '&::after': {
        backgroundColor: theme.colors.action.hover,
      },
    },
    '&:not(:first-child)': {
      marginLeft: theme.spacing(0.25),
    },
    // Underline (hidden by default, shown on active)
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: '2px',
      backgroundColor: 'transparent',
      borderRadius: theme.shape.radius.default,
      transition: 'background-color 0.2s ease',
    },
  }),
  activeTab: css({
    label: 'combined-journey-active-tab',
    backgroundColor: 'transparent',
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    // Primary blue underline like Grafana UI Tabs
    '&::after': {
      backgroundImage: theme.colors.gradients.brandHorizontal,
    },
  }),
  tabContent: css({
    label: 'combined-journey-tab-content',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
    minWidth: 0, // Allow shrinking to fit parent
    overflow: 'hidden', // Prevent overflow
  }),
  tabIcon: css({
    label: 'combined-journey-tab-icon',
    color: 'inherit',
    flexShrink: 0,
  }),
  tabTitle: css({
    label: 'combined-journey-tab-title',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    fontWeight: 'inherit',
    color: 'inherit',
    flex: 1,
    minWidth: 0, // Critical for allowing text truncation in flex containers
    maxWidth: '100%', // Ensure it doesn't exceed parent
  }),
  loadingText: css({
    marginLeft: theme.spacing(0.5),
  }),
  closeButton: css({
    label: 'combined-journey-close-button',
    padding: theme.spacing(0.25),
    margin: 0,
    minWidth: 'auto',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    flexShrink: 0,
    backgroundColor: 'transparent',
  }),
  // Tab overflow dropdown styles
  tabOverflow: css({
    label: 'combined-journey-tab-overflow',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0, // Don't shrink the chevron button
    zIndex: 1, // Ensure it's above other content
  }),
  chevronTab: css({
    label: 'combined-journey-chevron-tab',
    minWidth: '100px',
    maxWidth: '120px',
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.strong,
    },
  }),
  chevronIcon: css({
    label: 'combined-journey-chevron-icon',
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
  tabDropdown: css({
    label: 'combined-journey-tab-dropdown',
    position: 'absolute',
    top: '100%',
    right: 0, // Align with the right edge of the chevron button
    zIndex: 9999, // High z-index to appear above content
    minWidth: '220px',
    maxWidth: '320px',
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    padding: theme.spacing(0.5),
    marginTop: theme.spacing(0.25),
    maxHeight: '60vh',
    overflowY: 'auto',

    // Prevent clipping on small screens
    '@media (max-width: 480px)': {
      right: 'auto',
      left: 0,
      minWidth: '200px',
      maxWidth: '280px',
    },

    // Ensure dropdown doesn't extend beyond viewport
    transform: 'translateX(0)',

    // Alternative positioning when there's not enough space on the right
    '&[data-position="left"]': {
      right: 'auto',
      left: 0,
    },
  }),
  dropdownItem: css({
    label: 'combined-journey-dropdown-item',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(0.75, 1),
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    color: theme.colors.text.primary,
    textAlign: 'left',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
    '&:focus': {
      backgroundColor: theme.colors.action.hover,
      outline: `2px solid ${theme.colors.primary.main}`,
      outlineOffset: '-2px',
    },
  }),
  activeDropdownItem: css({
    label: 'combined-journey-active-dropdown-item',
    backgroundColor: theme.colors.primary.transparent,
    color: theme.colors.primary.main,
    fontWeight: theme.typography.fontWeightMedium,
    '&:hover': {
      backgroundColor: theme.colors.primary.transparent,
    },
  }),
  dropdownItemContent: css({
    label: 'combined-journey-dropdown-item-content',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
    minWidth: 0,
  }),
  dropdownItemIcon: css({
    label: 'combined-journey-dropdown-item-icon',
    color: 'inherit',
    flexShrink: 0,
  }),
  dropdownItemTitle: css({
    label: 'combined-journey-dropdown-item-title',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 'inherit',
  }),
  dropdownItemClose: css({
    label: 'combined-journey-dropdown-item-close',
    padding: theme.spacing(0.25),
    margin: 0,
    minWidth: 'auto',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    flexShrink: 0,
    opacity: 0.8,
    backgroundColor: 'transparent',
  }),
});

export const getContentStyles = (theme: GrafanaTheme2) => ({
  journeyContent: css({
    backgroundColor: theme.colors.background.secondary,
    border: 'none',
    overflow: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  }),
  docsContent: css({
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    overflow: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  }),
  // Dev Tools panel has its own internal layout - just provide scrolling container
  devToolsContent: css({
    backgroundColor: theme.colors.background.primary,
    overflow: 'auto',
    flex: 1,
    minHeight: 0, // Allow flex shrinking for proper scrolling
  }),
  contentMeta: css({
    padding: theme.spacing(1, 2),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }),
  metaInfo: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  contentActionBar: css({
    padding: theme.spacing(0.5, 2),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    minHeight: '32px',
  }),
  actionButton: css({
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),

    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.primary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },

    '&:active': {
      transform: 'translateY(0)',
      boxShadow: 'none',
    },

    '& svg': {
      width: '12px',
      height: '12px',
      flexShrink: 0,
    },
  }),
  secondaryActionButton: css({
    backgroundColor: 'transparent',
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'inline-flex',
    alignItems: 'center',
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
  }),
  // Return to Editor Banner - shown for WYSIWYG preview tabs
  returnToEditorBanner: css({
    padding: theme.spacing(1, 2),
    backgroundColor: theme.colors.info.transparent,
    borderBottom: `1px solid ${theme.colors.info.border}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing(2),
  }),
  returnToEditorLeft: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    color: theme.colors.info.text,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  returnToEditorButton: css({
    backgroundColor: theme.colors.info.main,
    color: theme.colors.info.contrastText,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1.5)}`,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    '&:hover': {
      backgroundColor: theme.colors.info.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },
    '&:active': {
      transform: 'translateY(0)',
      boxShadow: 'none',
    },
    '& svg': {
      width: '12px',
      height: '12px',
      flexShrink: 0,
    },
  }),
});

export const getMilestoneStyles = (theme: GrafanaTheme2) => ({
  milestoneProgress: css({
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
  }),
  progressInfo: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  progressHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  }),
  milestoneText: css({
    flex: 1,
    textAlign: 'center',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  navButton: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.25)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    minWidth: '70px',

    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.primary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },

    '&:active': {
      transform: 'translateY(0)',
      boxShadow: 'none',
    },

    '&:disabled': {
      backgroundColor: theme.colors.action.disabledBackground,
      color: theme.colors.action.disabledText,
      cursor: 'not-allowed',
      opacity: 0.5,
      transform: 'none',
      boxShadow: 'none',
    },

    '& svg': {
      width: '14px',
      height: '14px',
      flexShrink: 0,
    },
  }),
  progressBar: css({
    width: '100%',
    height: '3px',
    backgroundColor: theme.colors.background.secondary,
    borderRadius: '2px',
    overflow: 'hidden',
  }),
  progressFill: css({
    height: '100%',
    backgroundColor: theme.colors.success.main,
    transition: 'width 0.3s ease',
  }),
});

export const getHeaderBarStyles = (theme: GrafanaTheme2) => ({
  headerBar: css({
    label: 'docs-panel-header-bar',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(1, 1.5),
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  headerRight: css({
    label: 'docs-panel-header-right',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  headerDivider: css({
    label: 'docs-panel-header-divider',
    width: '1px',
    height: '20px',
    backgroundColor: theme.colors.border.weak,
  }),
});

// Combine all styles
export const getStyles = (theme: GrafanaTheme2) => ({
  ...getContainerStyles(theme),
  ...getHeaderBarStyles(theme),
  ...getTopBarStyles(theme),
  ...getTabStyles(theme),
  ...getContentStyles(theme),
  ...getMilestoneStyles(theme),
});
