import { css, keyframes } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

const skeletonShine = keyframes`
  to {
    background-position: 500px 0;
  }
`;

export const getSkeletonStyles = (theme: GrafanaTheme2) => {
  // Define skeleton colors based on theme
  const skeletonColor1 = theme.isDark ? theme.colors.background.secondary : '#f6f7f8';
  const skeletonColor2 = theme.isDark ? theme.colors.border.weak : '#edeef1';

  return {
    skeleton: css({
      padding: theme.spacing(2),
      
      // Loading Animation for Skeleton
      // Use :empty selector to make sure that no wrapper containers use loading animations
      '*:empty': {
        background: skeletonColor1,
        backgroundPosition: '-500px 0',
        animation: `${skeletonShine} 1s linear 0s infinite normal forwards`,
        backgroundImage: `linear-gradient(135deg, ${skeletonColor1} 0%, ${skeletonColor2} 20%, ${skeletonColor1} 40%, ${skeletonColor1} 100%)`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '1000px 100%',
        borderRadius: theme.shape.radius.default,
      },
    }),

    // Sections
    section: css({
      '& + &': {
        marginTop: theme.spacing(2),
      },
    }),

    // Headers
    header: css({
      marginBottom: theme.spacing(1),
      height: '32px',
      width: '300px',
      maxWidth: '60%',
    }),

    subHeader: css({
      marginBottom: theme.spacing(1),
      height: '24px',
      width: '200px',
      maxWidth: '40%',
    }),

    sectionHeader: css({
      marginBottom: theme.spacing(1),
      height: '20px',
      width: '180px',
      maxWidth: '35%',
      marginTop: theme.spacing(2),
    }),

    hr: css({
      height: '2px',
      width: '100%',
      marginBottom: theme.spacing(2),
    }),

    // Progress bar for learning journeys
    progressBar: css({
      height: '8px',
      width: '100%',
      marginBottom: theme.spacing(2),
    }),

    // Paragraphs
    paragraph: css({
      height: '16px',
      width: '100%',
      marginBottom: theme.spacing(1),
      
      '&:last-child': {
        width: '45%',
      },
    }),

    // Table of Contents
    tocItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      marginBottom: theme.spacing(0.5),
    }),

    tocBullet: css({
      height: '8px',
      width: '8px',
      borderRadius: '50%',
      flexShrink: 0,
    }),

    tocText: css({
      height: '16px',
      flex: 1,
      maxWidth: '200px',
    }),

    // Interactive Elements (Learning Journey specific)
    interactiveHeader: css({
      height: '24px',
      width: '250px',
      maxWidth: '50%',
      marginBottom: theme.spacing(2),
    }),

    interactiveStep: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(2),
      marginBottom: theme.spacing(2),
      padding: theme.spacing(2),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: 'transparent',
    }),

    stepIcon: css({
      height: '24px',
      width: '24px',
      borderRadius: theme.shape.radius.default,
      flexShrink: 0,
    }),

    stepContent: css({
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),

    stepTitle: css({
      height: '18px',
      width: '150px',
      maxWidth: '80%',
    }),

    stepDescription: css({
      height: '14px',
      width: '200px',
      maxWidth: '90%',
    }),

    stepButton: css({
      height: '32px',
      width: '80px',
      flexShrink: 0,
    }),

    // Code Blocks
    codeBlock: css({
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2),
      backgroundColor: theme.colors.background.secondary,
    }),

    codeHeader: css({
      height: '20px',
      width: '120px',
      marginBottom: theme.spacing(1),
    }),

    codeLine: css({
      height: '16px',
      width: '100%',
      marginBottom: theme.spacing(0.5),
      
      '&:nth-child(2)': {
        width: '80%',
      },
      '&:nth-child(3)': {
        width: '60%',
      },
      '&:nth-child(4)': {
        width: '90%',
      },
      '&:nth-child(5)': {
        width: '70%',
      },
      '&:last-child': {
        marginBottom: 0,
      },
    }),

    // Tables
    table: css({
      width: '100%',
    }),

    tableRow: css({
      display: 'flex',
      gap: theme.spacing(1.5),
      marginBottom: theme.spacing(0.5),
      
      '&:first-child': {
        marginBottom: theme.spacing(1.5),
      },
    }),

    tableHeader: css({
      flex: 1,
      height: '24px',
      
      '&:nth-child(1)': {
        flexBasis: '20%',
      },
      '&:nth-child(2)': {
        flexBasis: '40%',
      },
      '&:nth-child(3)': {
        flexBasis: '25%',
      },
      '&:nth-child(4)': {
        flexBasis: '15%',
      },
    }),

    tableCell: css({
      flex: 1,
      height: '16px',
      
      '&:nth-child(1)': {
        flexBasis: '20%',
      },
      '&:nth-child(2)': {
        flexBasis: '40%',
      },
      '&:nth-child(3)': {
        flexBasis: '25%',
      },
      '&:nth-child(4)': {
        flexBasis: '15%',
      },
    }),

    // Navigation (Learning Journey specific)
    navigationButtons: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: theme.spacing(3),
    }),

    navButton: css({
      height: '36px',
      width: '120px',
    }),

    // Recommendations Panel Specific Styles
    recommendationsHeader: css({
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(2),
      marginBottom: theme.spacing(3),
    }),

    headerIcon: css({
      height: '32px',
      width: '32px',
      borderRadius: theme.shape.radius.default,
      flexShrink: 0,
      marginTop: theme.spacing(0.5),
    }),

    headerContent: css({
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),

    sectionTitle: css({
      height: '28px',
      width: '280px',
      maxWidth: '80%',
    }),

    sectionSubtitle: css({
      height: '16px',
      width: '100%',
      maxWidth: '90%',
    }),

    // Simple recommendation bars (like table rows)
    recommendationBars: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
      marginBottom: theme.spacing(3),
    }),

    recommendationBar: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(2),
      padding: theme.spacing(2),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.primary,
      minHeight: '60px', // Consistent height like the actual recommendation cards
    }),

    barContent: css({
      flex: 1,
      height: '20px',
      maxWidth: '70%',
    }),

    barButton: css({
      height: '32px',
      width: '80px',
      flexShrink: 0,
    }),

    otherDocsHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      marginBottom: theme.spacing(2),
      padding: theme.spacing(1.5),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.secondary,
    }),

    otherDocsIcon: css({
      height: '16px',
      width: '16px',
      flexShrink: 0,
    }),

    otherDocsTitle: css({
      height: '16px',
      width: '140px',
      flex: 1,
    }),

    otherDocsCount: css({
      height: '14px',
      width: '60px',
      flexShrink: 0,
    }),

    otherDocsToggle: css({
      height: '16px',
      width: '16px',
      flexShrink: 0,
    }),

    otherDocsList: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),

    otherDocItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      padding: theme.spacing(1),
    }),

    docItemIcon: css({
      height: '16px',
      width: '16px',
      flexShrink: 0,
    }),

    docItemTitle: css({
      height: '16px',
      flex: 1,
      maxWidth: '80%',
    }),
  };
};
