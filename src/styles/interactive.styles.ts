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
      paddingLeft: theme.spacing(3),
      margin: `${theme.spacing(1)} 0`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      
      '&::before': {
        left: 0,
        top: '50%',
        transform: 'translateY(-50%)',
      },
    },
    
    // Style non-interactive list items within sequences
    '& li:not(.interactive)': {
      margin: `${theme.spacing(1)} 0`,
      color: theme.colors.text.primary,
      paddingLeft: theme.spacing(3),
      display: 'flex',
      alignItems: 'center',
      minHeight: '24px',
      
      // Add a subtle bullet point for non-interactive items
      '&::before': {
        content: '"•"',
        position: 'absolute',
        left: theme.spacing(1),
        color: theme.colors.text.secondary,
        fontSize: '12px',
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
      paddingLeft: theme.spacing(3), // Space for icon
      
      // Add small subtle icon indicator
      '&::before': {
        content: '"▶"',
        position: 'absolute',
        left: 0,
        top: '0.3em',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        backgroundColor: theme.colors.primary.main,
        color: theme.colors.primary.contrastText,
        borderRadius: '50%',
        fontSize: '8px',
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

  // Style the actual "Do It" buttons that are in the HTML
  '& button[onclick*="interactive-"]': {
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    marginLeft: theme.spacing(1),
    
    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },
    
    '&:active': {
      transform: 'translateY(0)',
      boxShadow: 'none',
    },
  },

  // Special styling for section buttons
  '& button[onclick*="interactive-sequence"]': {
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
  '& .interactive[data-targetaction="sequence"] > button[onclick*="interactive-sequence"]': {
    alignSelf: 'flex-start',
    marginTop: theme.spacing(2),
    marginLeft: 0,
    display: 'inline-block',
  },
  
  // Keyframes for animations
  '@keyframes spin': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' },
  },
  
  // Different action type styling - more subtle icons
  '& .interactive[data-targetaction="highlight"]:not(.interactive-completed):not(.interactive-running):not(.interactive-error)::before': {
    content: '"👁"',
    fontSize: '9px',
  },
  
  '& .interactive[data-targetaction="button"]:not(.interactive-completed):not(.interactive-running):not(.interactive-error)::before': {
    content: '"🔘"',
    fontSize: '8px',
  },
  
  '& .interactive[data-targetaction="formfill"]:not(.interactive-completed):not(.interactive-running):not(.interactive-error)::before': {
    content: '"📝"',
    fontSize: '8px',
  },
  
  '& .interactive[data-targetaction="sequence"]:not(.interactive-completed):not(.interactive-running):not(.interactive-error)::before': {
    content: '"📋"',
    fontSize: '8px',
    display: 'none', // Hidden for sequence containers
  },
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
      20% {
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 8px rgba(255, 136, 0, 0.3);
      }
      50% { 
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 12px rgba(255, 136, 0, 0.2);
      }
      80% {
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 8px rgba(255, 136, 0, 0.1);
      }
      100% {
        opacity: 0;
        transform: scale(1.02);
        box-shadow: 0 0 0 0 rgba(255, 136, 0, 0);
      }
    }
  `;
  
  document.head.appendChild(style);
}; 