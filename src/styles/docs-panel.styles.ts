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
    overflow: 'hidden',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.canvas,
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
    overflow: 'hidden',
  }),
  tabList: css({
    label: 'combined-journey-tab-list',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    overflow: 'auto',
    flex: 1,
    '&::-webkit-scrollbar': {
      height: '4px',
    },
    '&::-webkit-scrollbar-track': {
      background: 'transparent',
    },
    '&::-webkit-scrollbar-thumb': {
      background: theme.colors.border.medium,
      borderRadius: '2px',
    },
  }),
  tab: css({
    label: 'combined-journey-tab',
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(0.75, 1.5),
    cursor: 'pointer',
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderBottom: 'none',
    borderRadius: `${theme.shape.radius.default}px ${theme.shape.radius.default}px 0 0`,
    minWidth: '140px',
    maxWidth: '220px',
    position: 'relative',
    transition: 'all 0.2s ease',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
    },
    '&:not(:first-child)': {
      marginLeft: '-1px',
    },
  }),
  activeTab: css({
    label: 'combined-journey-active-tab',
    backgroundColor: theme.colors.background.primary,
    borderColor: theme.colors.border.medium,
    borderBottomColor: theme.colors.background.primary,
    zIndex: 1,
    '&:hover': {
      backgroundColor: theme.colors.background.primary,
    },
  }),
  tabContent: css({
    label: 'combined-journey-tab-content',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
    minWidth: 0,
  }),
  tabIcon: css({
    label: 'combined-journey-tab-icon',
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
  tabTitle: css({
    label: 'combined-journey-tab-title',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    flex: 1,
    minWidth: 0,
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
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),
});

export const getContentStyles = (theme: GrafanaTheme2) => ({
  journeyContent: css({
    backgroundColor: theme.colors.background.secondary,
    border: 'none',
    overflow: 'hidden',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  }),
  docsContent: css({
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
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
    '&:disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
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

// Combine all styles
export const getStyles = (theme: GrafanaTheme2) => ({
  ...getContainerStyles(theme),
  ...getTopBarStyles(theme),
  ...getTabStyles(theme),
  ...getContentStyles(theme),
  ...getMilestoneStyles(theme),
}); 