import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getInteractiveStyles = (theme: GrafanaTheme2) => css({
  // Interactive sequence containers - light border encapsulation
  '& .interactive[data-targetaction="sequence"]': {
    display: 'block',
    padding: theme.spacing(2),
    margin: `${theme.spacing(2)} 0`,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    position: 'relative',
    
    // Remove the default icon for sequence containers
    '&::before': {
      display: 'none',
    },
    
    // Style the list items inside sequences
    '& li.interactive': {
      paddingLeft: theme.spacing(4), // More space for better layout
      margin: `${theme.spacing(1)} 0`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      
      '&::before': {
        left: 0, // Use full container space
        top: '50%',
        transform: 'translateY(-50%)',
        width: '20px',
        height: '20px',
      },
    },
    
    // Style non-interactive list items within sequences
    '& li:not(.interactive)': {
      margin: `${theme.spacing(1)} 0`,
      color: theme.colors.text.primary,
      paddingLeft: theme.spacing(4), // Match interactive items spacing
      display: 'flex',
      alignItems: 'center',
      minHeight: '24px',
      position: 'relative', // Needed for absolute positioning
      
      // Add a subtle bullet point for non-interactive items
      '&::before': {
        content: '"•"',
        position: 'absolute',
        left: 0, // Use full container space
        top: '50%',
        transform: 'translateY(-50%)',
        color: theme.colors.text.secondary,
        fontSize: '14px',
        width: '20px',
        height: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    
    // Style the DO SECTION button properly
    '& > button[onclick*="interactive-sequence"]': {
      marginTop: theme.spacing(2),
      display: 'block',
      width: 'fit-content',
    },
  },

  // Interactive elements base styling
  '& .interactive': {
    position: 'relative',
    
    // Only add subtle icon indicator, no heavy styling
    '&[data-targetaction]:not([data-targetaction="sequence"])': {
      position: 'relative',
      paddingLeft: theme.spacing(4), // More space for better layout
      
      // Add consistent task icon indicator
      '&::before': {
        content: '"✓"', // Consistent task/check icon
        position: 'absolute',
        left: 0,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        backgroundColor: theme.colors.primary.main,
        color: theme.colors.primary.contrastText,
        borderRadius: '50%',
        fontSize: '10px',
        fontWeight: 'bold',
        flexShrink: 0,
        transition: 'all 0.2s ease',
        opacity: 0.7,
      },
      
      // Completed state styling
      '&.interactive-completed::before': {
        content: '"✓"',
        backgroundColor: theme.colors.success.main,
        color: theme.colors.success.contrastText,
        fontSize: '10px',
        opacity: 1,
      },
      
      // Running/active state styling
      '&.interactive-running::before': {
        content: '"⟳"',
        backgroundColor: theme.colors.warning.main,
        color: theme.colors.warning.contrastText,
        animation: 'spin 1s linear infinite',
        opacity: 1,
      },
      
      // Error state styling
      '&.interactive-error::before': {
        content: '"⚠"',
        backgroundColor: theme.colors.error.main,
        color: theme.colors.error.contrastText,
        opacity: 1,
      },
    },
  },

  // Button container for show me / do it buttons
  '& .interactive-button-container': {
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
    marginLeft: theme.spacing(1),
    flexShrink: 0,
  },

  // Style the actual "Show me" and "Do It" buttons that are in the HTML
  '& button[onclick*="interactive-"]': {
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    
    '&:hover': {
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },
    
    '&:active': {
      transform: 'translateY(0)',
      boxShadow: 'none',
    },
  },

  // Show me button styling
  '& .interactive-show-button': {
    backgroundColor: theme.colors.secondary.main,
    color: theme.colors.secondary.contrastText,
    
    '&:hover': {
      backgroundColor: theme.colors.secondary.shade,
    },
  },

  // Do it button styling
  '& .interactive-do-button': {
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    
    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
    },
  },

  // Special styling for section buttons
  '& .interactive-sequence-button': {
    padding: `${theme.spacing(0.75)} ${theme.spacing(2)}`,
    backgroundColor: theme.colors.action.disabledBackground,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    fontWeight: theme.typography.fontWeightMedium,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontSize: theme.typography.bodySmall.fontSize,
    
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.strong,
    },
  },
  
  // Override for section buttons inside sequence containers
  '& .interactive[data-targetaction="sequence"] .interactive-button-container': {
    marginTop: theme.spacing(2),
    marginLeft: 0,
    justifyContent: 'flex-start',
  },
  
  // Keyframes for animations
  '@keyframes spin': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' },
  },
  
  // All interactive elements use the same task icon - no action-specific styling needed
});

// Separate function for adding global interactive styles
export const addGlobalInteractiveStyles = () => {
  const interactiveStyleId = 'interactive-global-styles';
  
  // Check if styles already exist
  if (document.getElementById(interactiveStyleId)) {
    return;
  }
  
  const style = document.createElement('style');
  style.id = interactiveStyleId;
  style.textContent = `
    /* Global interactive element styles */
    .interactive-highlighted {
      position: relative;
      z-index: 1;
    }
    
    .interactive-highlight-outline {
      animation: highlight-pulse 2s ease-in-out forwards;
    }
    
    @keyframes highlight-pulse {
      0% { 
        opacity: 0;
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(255, 136, 0, 0.4);
      }
      25% {
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 8px rgba(255, 136, 0, 0.3);
      }
      50% { 
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 12px rgba(255, 136, 0, 0.2);
      }
      75% {
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 8px rgba(255, 136, 0, 0.1);
      }
      100% {
        opacity: 0;
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(255, 136, 0, 0);
      }
    }
  `;
  
  document.head.appendChild(style);
}; 