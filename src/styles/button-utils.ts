import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

// Base button styles that can be extended
export const createButtonBase = (theme: GrafanaTheme2) => css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: theme.shape.radius.default,
  fontWeight: theme.typography.fontWeightMedium,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  textDecoration: 'none',
  
  '&:disabled': {
    opacity: 0.6,
    cursor: 'not-allowed',
    pointerEvents: 'none',
  },
  
  '&:focus': {
    outline: 'none',
    boxShadow: `0 0 0 2px ${theme.colors.primary.main}33`,
  },
});

// Primary button variant
export const createPrimaryButton = (theme: GrafanaTheme2, options: {
  size?: 'sm' | 'md' | 'lg';
  minWidth?: string;
} = {}) => {
  const { size = 'md', minWidth } = options;
  
  const sizeMap = {
    sm: {
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      fontSize: theme.typography.bodySmall.fontSize,
      gap: theme.spacing(0.5),
    },
    md: {
      padding: `${theme.spacing(0.75)} ${theme.spacing(1.25)}`,
      fontSize: theme.typography.body.fontSize,
      gap: theme.spacing(0.75),
    },
    lg: {
      padding: `${theme.spacing(1.5)} ${theme.spacing(3)}`,
      fontSize: theme.typography.h6.fontSize,
      gap: theme.spacing(1),
    },
  };
  
  const sizeStyles = sizeMap[size];
  
  return css(
    createButtonBase(theme),
    {
      backgroundColor: theme.colors.primary.main,
      color: theme.colors.primary.contrastText,
      ...sizeStyles,
      ...(minWidth && { minWidth }),
      
      '&:hover:not(:disabled)': {
        backgroundColor: theme.colors.primary.shade,
        transform: 'translateY(-1px)',
        boxShadow: theme.shadows.z1,
      },
      
      '&:active': {
        transform: 'translateY(0)',
        boxShadow: 'none',
      },
    }
  );
};

// Secondary button variant  
export const createSecondaryButton = (theme: GrafanaTheme2, options: {
  size?: 'sm' | 'md' | 'lg';
  minWidth?: string;
} = {}) => {
  const { size = 'md', minWidth } = options;
  
  const sizeMap = {
    sm: {
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      fontSize: theme.typography.bodySmall.fontSize,
      gap: theme.spacing(0.5),
    },
    md: {
      padding: `${theme.spacing(0.75)} ${theme.spacing(1.25)}`,
      fontSize: theme.typography.body.fontSize,
      gap: theme.spacing(0.75),
    },
    lg: {
      padding: `${theme.spacing(1.5)} ${theme.spacing(3)}`,
      fontSize: theme.typography.h6.fontSize,
      gap: theme.spacing(1),
    },
  };
  
  const sizeStyles = sizeMap[size];
  
  return css(
    createButtonBase(theme),
    {
      backgroundColor: theme.colors.secondary.main,
      color: theme.colors.secondary.contrastText,
      border: `1px solid ${theme.colors.secondary.border}`,
      ...sizeStyles,
      ...(minWidth && { minWidth }),
      
      '&:hover:not(:disabled)': {
        backgroundColor: theme.colors.secondary.shade,
        borderColor: theme.colors.secondary.shade,
        transform: 'translateY(-1px)',
        boxShadow: theme.shadows.z1,
      },
      
      '&:active': {
        transform: 'translateY(0)',
        boxShadow: 'none',
      },
    }
  );
};

// Utility button (for copy buttons, close buttons, etc.)
export const createUtilityButton = (theme: GrafanaTheme2, options: {
  size?: 'xs' | 'sm' | 'md';
  variant?: 'ghost' | 'outline';
} = {}) => {
  const { size = 'sm', variant = 'ghost' } = options;
  
  const sizeMap = {
    xs: {
      padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
      fontSize: '10px',
      minWidth: '16px',
      minHeight: '16px',
    },
    sm: {
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      fontSize: theme.typography.bodySmall.fontSize,
      minWidth: '24px',
      minHeight: '24px',
    },
    md: {
      padding: `${theme.spacing(0.75)} ${theme.spacing(1.25)}`,
      fontSize: theme.typography.body.fontSize,
      minWidth: '32px',
      minHeight: '32px',
    },
  };
  
  const sizeStyles = sizeMap[size];
  
  const variantStyles = variant === 'outline' ? {
    backgroundColor: 'transparent',
    color: theme.colors.text.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
      color: theme.colors.text.primary,
    },
  } : {
    backgroundColor: 'transparent',
    color: theme.colors.text.secondary,
    
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  };
  
  return css(
    createButtonBase(theme),
    {
      ...sizeStyles,
      ...variantStyles,
    }
  );
}; 
