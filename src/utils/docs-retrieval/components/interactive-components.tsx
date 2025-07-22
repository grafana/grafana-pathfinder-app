// Interactive React Components
// These will eventually replace the DOM processing approach in interactive.hook.ts

import React, { useState, useCallback, useMemo } from 'react';
import { IconButton, Button, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

// Base props for all interactive components
interface BaseInteractiveProps {
  /** Requirements that must be met before this element can be interacted with */
  requirements?: string;
  
  /** Outcomes that are set when this element is completed */
  outcomes?: string;
  
  /** Hints to show when requirements are not met */
  hints?: string;
  
  /** Called when the interactive action is completed */
  onComplete?: () => void;
  
  /** Whether this element is disabled */
  disabled?: boolean;
  
  /** Additional CSS classes */
  className?: string;
}

interface InteractiveStepProps extends BaseInteractiveProps {
  /** The target action type */
  targetAction: 'button' | 'highlight' | 'formfill' | 'navigate' | 'sequence';
  
  /** The target reference (CSS selector, button text, etc.) */
  refTarget: string;
  
  /** Value for form fill actions */
  targetValue?: string;
  
  /** Button type - show or do */
  buttonType?: 'show' | 'do';
  
  /** Step title */
  title?: string;
  
  /** Step description */
  description?: string;
  
  /** Children content */
  children?: React.ReactNode;
}

interface InteractiveSectionProps extends BaseInteractiveProps {
  /** Section title */
  title: string;
  
  /** Section description */
  description?: string;
  
  /** Child interactive steps */
  children: React.ReactNode;
  
  /** Whether this section is a sequence that should run steps in order */
  isSequence?: boolean;
}

interface CodeBlockProps {
  /** Code content */
  code: string;
  
  /** Programming language */
  language?: string;
  
  /** Whether to show copy button */
  showCopy?: boolean;
  
  /** Whether this is inline code */
  inline?: boolean;
  
  /** Additional CSS classes */
  className?: string;
}

interface ExpandableTableProps {
  /** Table content (HTML string for now) */
  content: string;
  
  /** Whether table starts collapsed */
  defaultCollapsed?: boolean;
  
  /** Toggle button text */
  toggleText?: string;
  
  /** Additional CSS classes */
  className?: string;
}

interface ImageRendererProps {
  /** Image source URL */
  src?: string;
  
  /** Data source URL (for lazy loading) */
  dataSrc?: string;
  
  /** Alternative text */
  alt?: string;
  
  /** Image width */
  width?: string | number;
  
  /** Image height */
  height?: string | number;
  
  /** CSS classes */
  className?: string;
  
  /** Base URL for resolving relative URLs */
  baseUrl: string;
  
  /** Title attribute */
  title?: string;
  
  /** Custom click handler */
  onClick?: () => void;
  
  /** Additional props */
  [key: string]: any;
}

/**
 * Image Renderer - handles image display with URL resolution and lightbox
 * Replaces complex DOM parsing for image handling
 */
export function ImageRenderer({
  src,
  dataSrc,
  alt,
  width,
  height,
  className,
  baseUrl,
  title,
  onClick,
  ...props
}: ImageRendererProps) {
  const theme = useTheme2();
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Resolve URL (much simpler than DOM parsing)
  const resolvedSrc = useMemo(() => {
    const imgSrc = src || dataSrc;
    if (!imgSrc || !baseUrl) return imgSrc;
    
    if (imgSrc.startsWith('/') && !imgSrc.startsWith('//')) {
      return new URL(imgSrc, baseUrl).href;
    }
    return imgSrc;
  }, [src, dataSrc, baseUrl]);

  const styles = getImageStyles(theme);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (onClick) {
      onClick();
    } else {
      // Default lightbox behavior
      setIsLightboxOpen(true);
    }
  }, [onClick]);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  const handleCloseLightbox = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setIsLightboxOpen(false);
    }
  }, []);

  if (imageError) {
    return (
      <div className={styles.errorContainer}>
        <span className={styles.errorText}>
          Failed to load image: {alt || 'Image'}
        </span>
      </div>
    );
  }

  return (
    <>
      <img
        src={resolvedSrc}
        alt={alt || ''}
        title={title || alt}
        width={width}
        height={height}
        className={`content-image ${styles.image} ${className || ''}`}
        onClick={handleClick}
        onError={handleImageError}
        {...props}
      />
      
      {/* Lightbox Modal */}
      {isLightboxOpen && (
        <div className={styles.lightboxOverlay} onClick={handleCloseLightbox}>
          <div className={styles.lightboxContainer}>
            <div className={styles.lightboxHeader}>
              <span className={styles.lightboxTitle}>
                {title || alt || 'Image'}
              </span>
              <IconButton
                name="times"
                size="lg"
                aria-label="Close lightbox"
                onClick={() => setIsLightboxOpen(false)}
                className={styles.lightboxClose}
              />
            </div>
            <div className={styles.lightboxContent}>
              <img
                src={resolvedSrc}
                alt={alt || ''}
                className={`content-image ${styles.lightboxImage}`}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
  
}

/**
 * Interactive Section - groups related interactive steps
 * Replaces the sequence detection and grouping in interactive.hook.ts
 */
export function InteractiveSection({
  title,
  description,
  children,
  isSequence = false,
  requirements,
  outcomes,
  hints,
  onComplete,
  disabled = false,
  className,
}: InteractiveSectionProps) {
  const theme = useTheme2();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);

  const styles = getSectionStyles(theme);

  const handleStepComplete = useCallback(() => {
    // Check if all steps are completed (placeholder logic)
    if (onComplete) {
      setIsCompleted(true);
      onComplete();
    }
  }, [onComplete]);

  return (
    <div className={`${styles.section} ${className || ''} ${isCompleted ? styles.completed : ''}`}>
      <div className={styles.header}>
        <button
          className={styles.toggleButton}
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          disabled={disabled}
        >
          <span className={styles.icon}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className={styles.title}>{title}</span>
          {isCompleted && <span className={styles.checkmark}>✓</span>}
        </button>
        {hints && !isExpanded && (
          <span className={styles.hint} title={hints}>
            ⓘ
          </span>
        )}
      </div>
      
      {description && isExpanded && (
        <div className={styles.description}>{description}</div>
      )}
      
      {isExpanded && (
        <div className={styles.content}>
          {React.Children.map(children, (child) => 
            React.isValidElement(child) 
              ? React.cloneElement(child as React.ReactElement<any>, { 
                  onComplete: handleStepComplete,
                  disabled: disabled || child.props.disabled,
                })
              : child
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Interactive Step - individual actionable step
 * Replaces the individual button handling in interactive.hook.ts
 */
export function InteractiveStep({
  targetAction,
  refTarget,
  targetValue,
  buttonType = 'do',
  title,
  description,
  children,
  requirements,
  outcomes,
  hints,
  onComplete,
  disabled = false,
  className,
}: InteractiveStepProps) {
  const theme = useTheme2();
  const [isRunning, setIsRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const styles = getStepStyles(theme);

  const handleAction = useCallback(async () => {
    if (disabled || isRunning || isCompleted) {return;}

    setIsRunning(true);

    try {
      // Execute the interactive action using the bridge to existing system
      await bridgeExecuteAction(targetAction, refTarget, targetValue, buttonType);
      
      setIsCompleted(true);
      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error('Interactive action failed:', error);
    } finally {
      setIsRunning(false);
    }
  }, [targetAction, refTarget, targetValue, buttonType, disabled, isRunning, isCompleted, onComplete]);

  const getActionButtonText = () => {
    if (isCompleted) {return '✓ Completed';}
    if (isRunning) {return 'Running...';}
    
    const prefix = buttonType === 'show' ? 'Show me' : 'Do';
    
    switch (targetAction) {
      case 'button': return `${prefix}: Click "${refTarget}"`;
      case 'highlight': return `${prefix}: Highlight element`;
      case 'formfill': return `${prefix}: Fill form`;
      case 'navigate': return `${prefix}: Navigate to ${refTarget}`;
      case 'sequence': return `${prefix}: Run sequence`;
      default: return `${prefix}: ${targetAction}`;
    }
  };

  return (
    <div className={`${styles.step} ${className || ''} ${isCompleted ? styles.completed : ''}`}>
      <div className={styles.content}>
        {title && <div className={styles.title}>{title}</div>}
        {description && <div className={styles.description}>{description}</div>}
        {children}
      </div>
      
      <div className={styles.actions}>
        <Button
          onClick={handleAction}
          disabled={disabled || isCompleted || isRunning}
          size="sm"
          variant={buttonType === 'show' ? 'secondary' : 'primary'}
          className={styles.actionButton}
          title={hints}
        >
          {getActionButtonText()}
        </Button>
        
        {isCompleted && (
          <span className={styles.completedIndicator}>✓</span>
        )}
      </div>
    </div>
  );
}

/**
 * Code Block with copy functionality
 * Replaces the code block processing in content-processing.hook.ts
 */
export function CodeBlock({
  code,
  language,
  showCopy = true,
  inline = false,
  className,
}: CodeBlockProps) {
  const theme = useTheme2();
  const [copied, setCopied] = useState(false);

  const styles = getCodeBlockStyles(theme);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.warn('Failed to copy code:', error);
    }
  }, [code]);

  if (inline) {
    return (
      <span className={`${styles.inlineCode} ${className || ''}`}>
        <code>{code}</code>
        {showCopy && (
          <button className={styles.inlineCopyButton} onClick={handleCopy} title="Copy code">
            {copied ? '✓' : '📋'}
          </button>
        )}
      </span>
    );
  }

  return (
    <div className={`${styles.codeBlock} ${className || ''}`}>
      <div className={styles.codeHeader}>
        {language && <span className={styles.language}>{language}</span>}
        {showCopy && (
          <IconButton
            name={copied ? 'check' : 'copy'}
            size="sm"
            onClick={handleCopy}
            tooltip={copied ? 'Copied!' : 'Copy code'}
            className={styles.copyButton}
          />
        )}
      </div>
      <pre className={styles.preElement}>
        <code className={language ? `language-${language}` : ''}>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Expandable Table
 * Replaces table processing in content-processing.hook.ts  
 */
export function ExpandableTable({
  content,
  defaultCollapsed = false,
  toggleText,
  className,
}: ExpandableTableProps) {
  const theme = useTheme2();
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const styles = getTableStyles(theme);

  return (
    <div className={`${styles.tableWrapper} ${className || ''}`}>
      <Button
        onClick={() => setIsCollapsed(!isCollapsed)}
        variant="secondary"
        size="sm"
        className={styles.toggleButton}
      >
        {toggleText || (isCollapsed ? 'Expand table' : 'Collapse table')}
      </Button>
      
      <div className={`${styles.tableContent} ${isCollapsed ? styles.collapsed : ''}`}>
        <div dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    </div>
  );
}

// Import the bridge service for connecting to existing interactive system
import { executeInteractiveAction as bridgeExecuteAction } from '../interactive-bridge';

/**
 * Styling functions
 */
function getImageStyles(theme: GrafanaTheme2) {
  return {
    image: css({
      maxWidth: '100%',
      height: 'auto',
      borderRadius: theme.shape.borderRadius(1),
      border: `1px solid ${theme.colors.border.weak}`,
      margin: `${theme.spacing(2)} auto`,
      display: 'block',
      boxShadow: theme.shadows.z1,
      transition: 'all 0.2s ease',
      cursor: 'zoom-in',
      
      '&:hover': {
        boxShadow: theme.shadows.z2,
        transform: 'scale(1.02)',
        borderColor: theme.colors.primary.main,
      },
    }),

    errorContainer: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100px',
      backgroundColor: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.borderRadius(1),
      margin: `${theme.spacing(2)} auto`,
    }),

    errorText: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontStyle: 'italic',
    }),

    // Lightbox styles
    lightboxOverlay: css({
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backdropFilter: 'blur(4px)',
    }),

    lightboxContainer: css({
      position: 'relative',
      maxWidth: '95vw',
      maxHeight: '95vh',
      backgroundColor: theme.colors.background.primary,
      borderRadius: theme.shape.borderRadius(2),
      boxShadow: theme.shadows.z3,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }),

    lightboxHeader: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing(2),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      backgroundColor: theme.colors.background.secondary,
    }),

    lightboxTitle: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      marginRight: theme.spacing(2),
      flex: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }),

    lightboxClose: css({
      flexShrink: 0,
    }),

    lightboxContent: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing(2),
      flex: 1,
      overflow: 'hidden',
    }),

    lightboxImage: css({
      maxWidth: '100%',
      maxHeight: '100%',
      objectFit: 'contain',
      borderRadius: theme.shape.borderRadius(1),
    }),
  };
}

function getSectionStyles(theme: GrafanaTheme2) {
  return {
    section: css({
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.borderRadius(1),
      marginBottom: theme.spacing(2),
      backgroundColor: theme.colors.background.secondary,
      
      '&.completed': {
        borderColor: theme.colors.success.border,
        backgroundColor: theme.colors.success.transparent,
      },
    }),
    
    completed: css({
      borderColor: theme.colors.success.border,
      backgroundColor: theme.colors.success.transparent,
    }),
    
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing(1, 2),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    }),
    
    toggleButton: css({
      background: 'none',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      cursor: 'pointer',
      fontSize: theme.typography.fontSize,
      color: theme.colors.text.primary,
      
      '&:hover': {
        color: theme.colors.text.link,
      },
      
      '&:disabled': {
        cursor: 'not-allowed',
        opacity: 0.6,
      },
    }),
    
    icon: css({}),
    title: css({ fontWeight: theme.typography.fontWeightMedium }),
    checkmark: css({ color: theme.colors.success.text }),
    hint: css({ color: theme.colors.text.secondary }),
    description: css({ 
      padding: theme.spacing(1, 2),
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    content: css({ padding: theme.spacing(2) }),
  };
}

function getStepStyles(theme: GrafanaTheme2) {
  return {
    step: css({
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      padding: theme.spacing(1.5),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.borderRadius(1),
      marginBottom: theme.spacing(1),
      
      '&.completed': {
        borderColor: theme.colors.success.border,
        backgroundColor: theme.colors.success.transparent,
      },
    }),
    
    completed: css({
      borderColor: theme.colors.success.border,
      backgroundColor: theme.colors.success.transparent,
    }),
    
    content: css({ flex: 1, paddingRight: theme.spacing(2) }),
    title: css({ 
      fontWeight: theme.typography.fontWeightMedium,
      marginBottom: theme.spacing(0.5),
    }),
    description: css({ 
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    actions: css({ 
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    actionButton: css({}),
    completedIndicator: css({ 
      color: theme.colors.success.text,
      fontSize: theme.typography.h6.fontSize,
    }),
  };
}

function getCodeBlockStyles(theme: GrafanaTheme2) {
  return {
    codeBlock: css({
      position: 'relative',
      marginBottom: theme.spacing(2),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.borderRadius(1),
      backgroundColor: theme.colors.background.canvas,
    }),
    
    codeHeader: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing(1, 2),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      backgroundColor: theme.colors.background.secondary,
    }),
    
    language: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    
    copyButton: css({}),
    
    preElement: css({
      margin: 0,
      padding: theme.spacing(2),
      backgroundColor: 'transparent',
      fontSize: theme.typography.code.fontSize,
      fontFamily: theme.typography.fontFamilyMonospace,
      overflow: 'auto',
    }),
    
    inlineCode: css({
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      backgroundColor: theme.colors.background.secondary,
      padding: theme.spacing(0.25, 0.5),
      borderRadius: theme.shape.borderRadius(0.5),
      fontSize: theme.typography.code.fontSize,
      fontFamily: theme.typography.fontFamilyMonospace,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    
    inlineCopyButton: css({
      marginLeft: theme.spacing(0.5),
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      fontSize: '12px',
      opacity: 0.7,
      
      '&:hover': {
        opacity: 1,
      },
    }),
  };
}

function getTableStyles(theme: GrafanaTheme2) {
  return {
    tableWrapper: css({
      marginBottom: theme.spacing(2),
    }),
    
    toggleButton: css({
      marginBottom: theme.spacing(1),
    }),
    
    tableContent: css({
      overflow: 'hidden',
      transition: 'max-height 0.3s ease',
      maxHeight: '1000px',
      
      '&.collapsed': {
        maxHeight: '0px',
      },
      
      '& table': {
        width: '100%',
        borderCollapse: 'collapse',
        
        '& th, & td': {
          border: `1px solid ${theme.colors.border.weak}`,
          padding: theme.spacing(1),
          textAlign: 'left',
        },
        
        '& th': {
          backgroundColor: theme.colors.background.secondary,
          fontWeight: theme.typography.fontWeightMedium,
        },
      },
    }),
    
    collapsed: css({
      maxHeight: '0px',
    }),
  };
} 
