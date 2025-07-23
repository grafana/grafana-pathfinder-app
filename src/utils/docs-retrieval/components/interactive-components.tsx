import React, { useState, useCallback, useMemo } from 'react';
import { IconButton, Button } from '@grafana/ui';
import { useInteractiveElements } from '../../interactive.hook';

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
  const [isRunning, setIsRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);

  // Get the interactive functions from the hook
  const { executeInteractiveAction } = useInteractiveElements();

  // Extract interactive steps from children
  const interactiveSteps = useMemo(() => {
    const steps: Array<{
      element: React.ReactElement;
      targetAction: string;
      refTarget: string;
      targetValue?: string;
      uniqueId: string;
    }> = [];
    
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && 
          (child as any).type === InteractiveStep) {
        const props = child.props as InteractiveStepProps;
        steps.push({
          element: child,
          targetAction: props.targetAction,
          refTarget: props.refTarget,
          targetValue: props.targetValue,
          uniqueId: `section-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${steps.length}`
        });
      }
    });
    
    return steps;
  }, [children]);

  const handleDoSection = useCallback(async () => {
    if (disabled || isRunning || isCompleted || interactiveSteps.length === 0) {
      return;
    }

    setIsRunning(true);
    setCurrentStepIndex(0);

    try {
      for (let i = 0; i < interactiveSteps.length; i++) {
        const step = interactiveSteps[i];
        setCurrentStepIndex(i);

        // First, show the step (highlight it)
        await executeInteractiveAction(
          step.targetAction,
          step.refTarget,
          step.targetValue,
          'show'
        );

        // Wait a bit for the highlight to be visible
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Then, do the step (perform the action)
        await executeInteractiveAction(
          step.targetAction,
          step.refTarget,
          step.targetValue,
          'do'
        );

        // Wait between steps
        if (i < interactiveSteps.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Mark the entire section as completed
      setIsCompleted(true);
      setCurrentStepIndex(-1);
      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error('Error running section sequence:', error);
      setCurrentStepIndex(-1);
    } finally {
      setIsRunning(false);
    }
  }, [disabled, isRunning, isCompleted, interactiveSteps, onComplete, executeInteractiveAction]);

  const getStepStatus = useCallback((stepIndex: number) => {
    if (isCompleted) return 'completed';
    if (currentStepIndex === stepIndex) return 'running';
    if (currentStepIndex > stepIndex) return 'completed';
    return 'pending';
  }, [isCompleted, currentStepIndex]);

  return (
    <div className={`interactive-section${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}`}>
      <div className="interactive-section-header">
        <div className="interactive-section-title-container">
          <span className="interactive-section-title">{title}</span>
          {isCompleted && <span className="interactive-section-checkmark">✓</span>}
          {isRunning && <span className="interactive-section-spinner">⟳</span>}
        </div>
        {hints && (
          <span className="interactive-section-hint" title={hints}>
            ⓘ
          </span>
        )}
      </div>
      
      {description && (
        <div className="interactive-section-description">{description}</div>
      )}
      
      <div className="interactive-section-content">
        {React.Children.map(children, (child, index) => {
          if (React.isValidElement(child) && 
              (child as any).type === InteractiveStep) {
            const stepStatus = getStepStatus(index);
            return React.cloneElement(child as React.ReactElement<any>, {
              disabled: disabled || isRunning,
              className: `${child.props.className || ''} step-status-${stepStatus}`,
              key: index,
            });
          }
          return child;
        })}
      </div>
      
      <div className="interactive-section-actions">
        <Button
          onClick={handleDoSection}
          disabled={disabled || isRunning || isCompleted || interactiveSteps.length === 0}
          size="md"
          variant="primary"
          className="interactive-section-do-button"
          title={hints || `Run through all ${interactiveSteps.length} steps in sequence`}
        >
          {isCompleted ? '✓ Section Completed' : 
           isRunning ? `Running Step ${currentStepIndex + 1}/${interactiveSteps.length}...` : 
           `Do Section (${interactiveSteps.length} steps)`}
        </Button>
      </div>
    </div>
  );
}

export function InteractiveStep({
  targetAction,
  refTarget,
  targetValue,
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
  const [isShowRunning, setIsShowRunning] = useState(false);
  const [isDoRunning, setIsDoRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  
  // Get the interactive functions from the hook
  const { executeInteractiveAction } = useInteractiveElements();

  const handleShowAction = useCallback(async () => {
    if (disabled || isShowRunning || isCompleted) return;
    setIsShowRunning(true);
    try {
      await executeInteractiveAction(targetAction, refTarget, targetValue, 'show');
      // Note: "Show me" actions don't mark the step as completed, only highlight
    } catch (error) {
      console.error('Interactive show action failed:', error);
    } finally {
      setIsShowRunning(false);
    }
  }, [targetAction, refTarget, targetValue, disabled, isShowRunning, isCompleted, executeInteractiveAction]);

  const handleDoAction = useCallback(async () => {
    if (disabled || isDoRunning || isCompleted) return;
    setIsDoRunning(true);
    try {
      await executeInteractiveAction(targetAction, refTarget, targetValue, 'do');
      setIsCompleted(true);
      if (onComplete) onComplete();
    } catch (error) {
      console.error('Interactive do action failed:', error);
    } finally {
      setIsDoRunning(false);
    }
  }, [targetAction, refTarget, targetValue, disabled, isDoRunning, isCompleted, onComplete, executeInteractiveAction]);

  const getActionDescription = () => {
    switch (targetAction) {
      case 'button': return `Click "${refTarget}"`;
      case 'highlight': return `Highlight element`;
      case 'formfill': return `Fill form with "${targetValue || 'value'}"`;
      case 'navigate': return `Navigate to ${refTarget}`;
      case 'sequence': return `Run sequence`;
      default: return targetAction;
    }
  };

  const isAnyActionRunning = isShowRunning || isDoRunning;

  return (
    <div className={`interactive-step${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}`}>
      <div className="interactive-step-content">
        {title && <div className="interactive-step-title">{title}</div>}
        {description && <div className="interactive-step-description">{description}</div>}
        {children}
      </div>
      <div className="interactive-step-actions">
        <div className="interactive-step-action-buttons">
          <Button
            onClick={handleShowAction}
            disabled={disabled || isCompleted || isAnyActionRunning}
            size="sm"
            variant="secondary"
            className="interactive-step-show-btn"
            title={hints || `Show me: ${getActionDescription()}`}
          >
            {isShowRunning ? 'Showing...' : 'Show me'}
          </Button>
          
          <Button
            onClick={handleDoAction}
            disabled={disabled || isCompleted || isAnyActionRunning}
            size="sm"
            variant="primary"
            className="interactive-step-do-btn"
            title={hints || `Do it: ${getActionDescription()}`}
          >
            {isCompleted ? '✓ Completed' : isDoRunning ? 'Doing...' : 'Do it'}
          </Button>
        </div>
        
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
