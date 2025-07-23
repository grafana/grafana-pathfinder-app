import React, { useState, useCallback, useMemo } from 'react';
import { IconButton, Button } from '@grafana/ui';

// --- Types ---
interface BaseInteractiveProps {
  requirements?: string;
  outcomes?: string;
  hints?: string;
  onComplete?: () => void;
  disabled?: boolean;
  className?: string;
}

interface InteractiveStepProps extends BaseInteractiveProps {
  targetAction: 'button' | 'highlight' | 'formfill' | 'navigate' | 'sequence';
  refTarget: string;
  targetValue?: string;
  buttonType?: 'show' | 'do';
  title?: string;
  description?: string;
  children?: React.ReactNode;
}

interface InteractiveSectionProps extends BaseInteractiveProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  isSequence?: boolean;
}

interface CodeBlockProps {
  code: string;
  language?: string;
  showCopy?: boolean;
  inline?: boolean;
  className?: string;
}

interface ExpandableTableProps {
  content: string;
  defaultCollapsed?: boolean;
  toggleText?: string;
  className?: string;
}

interface ImageRendererProps {
  src?: string;
  dataSrc?: string;
  alt?: string;
  width?: string | number;
  height?: string | number;
  className?: string;
  baseUrl: string;
  title?: string;
  onClick?: () => void;
  [key: string]: any;
}

interface SideJourneyLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  onOpenTab?: (url: string, title: string) => void;
}

// --- Components ---

export function SideJourneyLink({
  href,
  children,
  className,
  onOpenTab,
}: SideJourneyLinkProps) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    
    // Extract title from children if it's a string
    const title = typeof children === 'string' ? children : 'Documentation';
    
    if (onOpenTab) {
      // Use the callback to open in a new tab within the app
      onOpenTab(href, title);
    } else {
      // Fallback to external navigation
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }, [href, children, onOpenTab]);

  return (
    <a
      href={href}
      className={className}
      onClick={handleClick}
      data-side-journey-link="true"
    >
      {children}
    </a>
  );
}

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
  const resolvedSrc = useMemo(() => {
    const imgSrc = src || dataSrc;
    if (!imgSrc || !baseUrl) return imgSrc;
    if (imgSrc.startsWith('/') && !imgSrc.startsWith('//')) {
      return new URL(imgSrc, baseUrl).href;
    }
    return imgSrc;
  }, [src, dataSrc, baseUrl]);

  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      title={title || alt}
      width={width}
      height={height}
      className={`content-image${className ? ` ${className}` : ''}`}
      onClick={onClick}
      {...props}
    />
  );
}

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
  const [isExpanded, setIsExpanded] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);

  const handleStepComplete = useCallback(() => {
    if (onComplete) {
      setIsCompleted(true);
      onComplete();
    }
  }, [onComplete]);

  return (
    <div className={`interactive-section${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}`}>
      <div className="interactive-section-header">
        <button
          className="interactive-section-toggle"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          disabled={disabled}
        >
          <span className="interactive-section-icon">
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="interactive-section-title">{title}</span>
          {isCompleted && <span className="interactive-section-checkmark">✓</span>}
        </button>
        {hints && !isExpanded && (
          <span className="interactive-section-hint" title={hints}>
            ⓘ
          </span>
        )}
      </div>
      {description && isExpanded && (
        <div className="interactive-section-description">{description}</div>
      )}
      {isExpanded && (
        <div className="interactive-section-content">
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
  const [isRunning, setIsRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  
  // Generate a unique ID for this step that persists across renders (no prefix - system will add it)
  const uniqueId = useMemo(() => 
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
    []
  );

  const handleAction = useCallback(async () => {
    if (disabled || isRunning || isCompleted) {return;}
    setIsRunning(true);
    try {
      await bridgeExecuteAction(targetAction, refTarget, targetValue, buttonType, uniqueId);
      setIsCompleted(true);
      if (onComplete) onComplete();
    } catch (error) {
      console.error('Interactive action failed:', error);
    } finally {
      setIsRunning(false);
    }
  }, [targetAction, refTarget, targetValue, buttonType, uniqueId, disabled, isRunning, isCompleted, onComplete]);

  const getActionButtonText = () => {
    if (isCompleted) return '✓ Completed';
    if (isRunning) return 'Running...';
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
    <div className={`interactive-step${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}`}>
      <div className="interactive-step-content">
        {title && <div className="interactive-step-title">{title}</div>}
        {description && <div className="interactive-step-description">{description}</div>}
        {children}
      </div>
      <div className="interactive-step-actions">
        <Button
          onClick={handleAction}
          disabled={disabled || isCompleted || isRunning}
          size="sm"
          variant={buttonType === 'show' ? 'secondary' : 'primary'}
          className="interactive-step-action-btn"
          title={hints}
        >
          {getActionButtonText()}
        </Button>
        {isCompleted && <span className="interactive-step-completed-indicator">✓</span>}
      </div>
    </div>
  );
}

export function CodeBlock({
  code,
  language,
  showCopy = true,
  inline = false,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

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
      <span className={`inline-code${className ? ` ${className}` : ''}`}>
        <code>{code}</code>
        {showCopy && (
          <IconButton
            name={copied ? 'check' : 'copy'}
            size="xs"
            onClick={handleCopy}
            tooltip={copied ? 'Copied!' : 'Copy code'}
            className="inline-copy-btn"
          />
        )}
      </span>
    );
  }

  return (
    <div className={`code-block${className ? ` ${className}` : ''}`}>
      <div className="code-block-header">
        {language && <span className="code-block-language">{language}</span>}
        {showCopy && (
         <IconButton
            name={copied ? 'check' : 'copy'}
            size="xs"
            onClick={handleCopy}
            tooltip={copied ? 'Copied!' : 'Copy code'}
            className="inline-copy-btn"
          />
        )}
      </div>
      <pre className="code-block-pre">
        <code className={language ? `language-${language}` : ''}>{code}</code>
      </pre>
    </div>
  );
}

export function ExpandableTable({
  content,
  defaultCollapsed = false,
  toggleText,
  className,
}: ExpandableTableProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className={`expandable-table${className ? ` ${className}` : ''}`}>
      <Button
        onClick={() => setIsCollapsed(!isCollapsed)}
        variant="secondary"
        size="sm"
        className="expandable-table-toggle-btn"
      >
        {toggleText || (isCollapsed ? 'Expand table' : 'Collapse table')}
      </Button>
      <div className={`expandable-table-content${isCollapsed ? ' collapsed' : ''}`}>
        <div dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    </div>
  );
}

// Import the bridge service for connecting to existing interactive system
import { executeInteractiveAction as bridgeExecuteAction } from '../interactive-bridge';
