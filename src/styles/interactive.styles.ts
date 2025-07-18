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
      paddingLeft: theme.spacing(2), // Align with button - matches container padding
      paddingRight: theme.spacing(2), // Reasonable right padding
      margin: `${theme.spacing(1)} 0`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between', // Push buttons to the right
      minHeight: '40px', // Ensure adequate height for content
      
      '&::before': {
        content: '"•"',
        position: 'absolute',
        left: `-${theme.spacing(2)}`, // Pull bullet back to align with button
        top: '50%',
        transform: 'translateY(-50%)',
        color: theme.colors.text.secondary,
        fontSize: '14px',
        width: '16px',
        height: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      },
    },
    
    // Style non-interactive list items within sequences
    '& li:not(.interactive)': {
      margin: `${theme.spacing(1)} 0`,
      color: theme.colors.text.primary,
      paddingLeft: theme.spacing(2), // Match interactive items spacing
      paddingRight: theme.spacing(2), // Add right padding for consistency
      display: 'flex',
      alignItems: 'center',
      minHeight: '40px', // Match interactive items height
      position: 'relative', // Needed for absolute positioning
      
      // Add a subtle bullet point for non-interactive items
      '&::before': {
        content: '"•"',
        position: 'absolute',
        left: `-${theme.spacing(2)}`, // Pull bullet back to align with button
        top: '50%',
        transform: 'translateY(-50%)',
        color: theme.colors.text.secondary,
        fontSize: '14px',
        width: '16px',
        height: '16px',
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
    
    // Simple bullet point styling for interactive elements
    '&[data-targetaction]:not([data-targetaction="sequence"])': {
      position: 'relative',
      paddingLeft: theme.spacing(2.5), // Proper padding to avoid bullet overlap
      paddingRight: theme.spacing(2), // Reasonable right padding
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between', // Push buttons to the right
      minHeight: '40px', // Ensure adequate height for content
      
      // Simple bullet point indicator
      '&::before': {
        content: '"•"',
        position: 'absolute',
        left: theme.spacing(0.5), // Consistent bullet position
        top: '50%',
        transform: 'translateY(-50%)',
        color: theme.colors.text.secondary,
        fontSize: '14px',
        width: '16px',
        height: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      },
    },
  },

  // Button container for show me / do it buttons
  '& .interactive-button-container': {
    display: 'flex',
    gap: theme.spacing(0.75), // Slightly larger gap between buttons
    alignItems: 'center',
    flexShrink: 0,
  },

  // Base button styling for all interactive buttons - follows Grafana button patterns
  '& .interactive-button': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${theme.spacing(0.5)} ${theme.spacing(1.25)}`, // Slightly larger padding
    border: `1px solid transparent`,
    borderRadius: theme.shape.radius.default,
    fontSize: '12px', // Slightly larger font size
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: '1.3', // Better line height
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease-in-out',
    position: 'relative',
    minHeight: `${theme.spacing(3.5)}`, // Slightly larger min height
    whiteSpace: 'nowrap',
    
    // Disabled state
    '&:disabled': {
      opacity: 0.65,
      cursor: 'not-allowed',
      pointerEvents: 'none',
    },
    
    // Focus state for accessibility
    '&:focus': {
      outline: 'none',
      boxShadow: `0 0 0 2px ${theme.colors.primary.main}33`,
    },
    
    // Active state
    '&:active': {
      transform: 'translateY(0)',
      boxShadow: 'none',
    },
  },

  // Show me button styling - Secondary button variant
  '& .interactive-show-button': {
    backgroundColor: theme.colors.secondary.main,
    color: theme.colors.secondary.contrastText,
    border: `1px solid ${theme.colors.secondary.border}`,
    
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.secondary.shade,
      borderColor: theme.colors.secondary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },
    
    '&:focus': {
      boxShadow: `0 0 0 2px ${theme.colors.secondary.main}33`,
    },
  },

  // Do it button styling - Primary button variant
  '& .interactive-do-button': {
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: `1px solid ${theme.colors.primary.border}`,
    
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.primary.shade,
      borderColor: theme.colors.primary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },
    
    '&:focus': {
      boxShadow: `0 0 0 2px ${theme.colors.primary.main}33`,
    },
  },

  // Special styling for section buttons - Tertiary button variant
  '& .interactive-sequence-button': {
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.75)}`, // Slightly larger padding
    backgroundColor: theme.colors.background.primary,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    fontWeight: theme.typography.fontWeightMedium,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontSize: '11px', // Consistent smaller font size for section buttons
    
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.strong,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },
    
    '&:focus': {
      boxShadow: `0 0 0 2px ${theme.colors.text.primary}33`,
    },
  },
  
  // Override for section buttons inside sequence containers
  '& .interactive[data-targetaction="sequence"] .interactive-button-container': {
    marginTop: theme.spacing(2),
    marginLeft: 0, // No left margin for section buttons
    justifyContent: 'flex-start',
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
    /* Global interactive element styles - CSP compliant */
    .interactive-highlighted {
      position: relative;
      z-index: 1;
    }
    
    .interactive-highlight-outline {
      position: absolute;
      top: var(--highlight-top);
      left: var(--highlight-left);
      width: var(--highlight-width);
      height: var(--highlight-height);
      border: 2px solid var(--grafana-warning-main, #FF8800);
      border-radius: 4px;
      pointer-events: none;
      z-index: 9999;
      background-color: var(--grafana-warning-transparent, rgba(255, 136, 0, 0.1));
      box-shadow: 0 0 0 4px var(--grafana-warning-transparent-medium, rgba(255, 136, 0, 0.2));
      animation: highlight-pulse 2s ease-in-out forwards;
    }
    
    @keyframes highlight-pulse {
      0% { 
        opacity: 0;
        transform: scale(0.95);
        box-shadow: 0 0 0 0 var(--grafana-warning-transparent-strong, rgba(255, 136, 0, 0.4));
      }
      25% {
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 8px var(--grafana-warning-transparent-medium, rgba(255, 136, 0, 0.3));
      }
      50% { 
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 12px var(--grafana-warning-transparent, rgba(255, 136, 0, 0.2));
      }
      75% {
        opacity: 1;
        transform: scale(1);
        box-shadow: 0 0 0 8px var(--grafana-warning-transparent-weak, rgba(255, 136, 0, 0.1));
      }
      100% {
        opacity: 0;
        transform: scale(0.95);
        box-shadow: 0 0 0 0 transparent;
      }
    }
  `;
  
  document.head.appendChild(style);
}; 
