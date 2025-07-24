import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { IconButton, Button, Alert } from '@grafana/ui';
import { useInteractiveElements } from '../../interactive.hook';
import { useSequentialRequirements } from '../../requirements-checker.hook';
import { ParseError } from '../content.types';

// Simple counters for sequential IDs
let interactiveStepCounter = 0;
let interactiveSectionCounter = 0;

// Function to reset counters (can be called when new content loads)
export function resetInteractiveCounters() {
  interactiveStepCounter = 0;
  interactiveSectionCounter = 0;
}

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

interface ContentParsingErrorProps {
  errors: ParseError[];
  warnings?: string[];
  fallbackHtml?: string;
  onRetry?: () => void;
  className?: string;
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
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);

  // Generate simple sequential section ID for requirements tracking
  const sectionId = useMemo(() => {
    interactiveSectionCounter++;
    return `section-${interactiveSectionCounter}`;
  }, []); // Empty deps so it only runs once per component mount

  // Use React-based requirements checking
  const requirementsChecker = useSequentialRequirements({
    requirements,
    hints,
    sectionId,
    targetAction: 'sequence',
    isSequence: true,
  });

  // Get the interactive functions from the hook
  const { executeInteractiveAction, checkElementRequirements } = useInteractiveElements();

  // Check requirements once when component mounts - prevent infinite loops
  const hasCheckedRequirements = useRef(false);
  useEffect(() => {
    if (!hasCheckedRequirements.current) {
      hasCheckedRequirements.current = true;
      requirementsChecker.checkRequirements();
    }
  }, []); // Empty dependency array to run only once

  // Local completion state (different from requirements completion)
  const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
  const isCompleted = requirementsChecker.isCompleted || isLocallyCompleted;

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
    if (disabled || isRunning || interactiveSteps.length === 0 || (!isCompleted && !requirementsChecker.isEnabled)) {
      return;
    }

    // If section is completed and we're re-running, reset the completion state
    if (isCompleted) {
      setIsLocallyCompleted(false);
      // Don't reset requirementsChecker completion state as it tracks the overall section requirements
    }

    setIsRunning(true);
    setCurrentStepIndex(0);

    try {
      for (let i = 0; i < interactiveSteps.length; i++) {
        const step = interactiveSteps[i];
        setCurrentStepIndex(i);

        // Always check step requirements before executing (as requested by user)
        if ((step.element.props as any).requirements) {
          // Create a mock element to check requirements
          const mockElement = document.createElement('div');
          mockElement.setAttribute('data-requirements', (step.element.props as any).requirements);
          mockElement.setAttribute('data-targetaction', step.targetAction);
          mockElement.setAttribute('data-reftarget', step.refTarget);
          
          // Check requirements using the hook function
          const requirementResult = await checkElementRequirements(mockElement);
          
          if (!requirementResult.pass) {
            console.warn(`Step ${i + 1} requirements not met:`, requirementResult.error);
            // Continue anyway but log the issue - section execution shouldn't stop for individual step requirements
          }
        }

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
      setIsLocallyCompleted(true);
      requirementsChecker.markCompleted();
      // After completing section, trigger reactive check to unlock next steps
      requirementsChecker.triggerReactiveCheck();
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
  }, [disabled, isRunning, isCompleted, interactiveSteps, onComplete, executeInteractiveAction, checkElementRequirements, requirementsChecker]);

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
          disabled={disabled || isRunning || interactiveSteps.length === 0 || (!isCompleted && !requirementsChecker.isEnabled)}
          size="md"
          variant={isCompleted ? "secondary" : "primary"}
          className="interactive-section-do-button"
          title={
            requirementsChecker.isChecking ? 'Checking requirements...' :
            isCompleted ? 'Run the section again' :
            !requirementsChecker.isEnabled && requirementsChecker.explanation ? requirementsChecker.explanation :
            hints || `Run through all ${interactiveSteps.length} steps in sequence`
          }
        >
          {requirementsChecker.isChecking ? 'Checking...' :
           isCompleted ? `Redo Section (${interactiveSteps.length} steps)` :
           isRunning ? `Running Step ${currentStepIndex + 1}/${interactiveSteps.length}...` : 
           !requirementsChecker.isEnabled ? 'Requirements not met' :
           `Do Section (${interactiveSteps.length} steps)`}
        </Button>
        
        {/* Show amber explanation text when requirements aren't met */}
        {!requirementsChecker.isEnabled && !isCompleted && !requirementsChecker.isChecking && requirementsChecker.explanation && (
          <div className="interactive-section-requirement-explanation" style={{ 
            color: '#ff8c00', 
            fontSize: '0.875rem', 
            marginTop: '8px',
            fontStyle: 'italic',
            lineHeight: '1.4'
          }}>
            {requirementsChecker.explanation}
                       <button
             onClick={() => {
               requirementsChecker.checkRequirements();
             }}
              style={{
                marginLeft: '8px',
                padding: '2px 8px',
                fontSize: '0.75rem',
                border: '1px solid #ff8c00',
                background: 'transparent',
                color: '#ff8c00',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Retry
            </button>
          </div>
        )}
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
  
  // Generate simple sequential step ID for requirements tracking
  const stepId = useMemo(() => {
    // Use a simple counter approach for predictable ordering
    interactiveStepCounter++;
    return `step-${interactiveStepCounter}`;
  }, []); // Empty deps so it only runs once per component mount

  // Use React-based requirements checking
  const requirementsChecker = useSequentialRequirements({
    requirements,
    hints,
    stepId,
    targetAction,
    isSequence: false,
  });
  
  // Get the interactive functions from the hook
  const { executeInteractiveAction } = useInteractiveElements();

  // Check requirements once when component mounts - prevent infinite loops
  const hasCheckedStepRequirements = useRef(false);
  useEffect(() => {
    if (!hasCheckedStepRequirements.current) {
      hasCheckedStepRequirements.current = true;
      requirementsChecker.checkRequirements();
    }
  }, []); // Empty dependency array to run only once

  // Local completion state (different from requirements completion)
  const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
  const isCompleted = requirementsChecker.isCompleted || isLocallyCompleted;

  const handleShowAction = useCallback(async () => {
    if (disabled || isShowRunning || isCompleted || !requirementsChecker.isEnabled) return;
    
    setIsShowRunning(true);
    try {
      await executeInteractiveAction(targetAction, refTarget, targetValue, 'show');
      // After show action, trigger a reactive check of all steps in case DOM changed
      requirementsChecker.triggerReactiveCheck();
    } catch (error) {
      console.error('Interactive show action failed:', error);
    } finally {
      setIsShowRunning(false);
    }
  }, [targetAction, refTarget, targetValue, disabled, isShowRunning, isCompleted, executeInteractiveAction, stepId, requirementsChecker]);

  const handleDoAction = useCallback(async () => {
    if (disabled || isDoRunning || isCompleted || !requirementsChecker.isEnabled) return;
    
    setIsDoRunning(true);
    try {
      await executeInteractiveAction(targetAction, refTarget, targetValue, 'do');
      
      // Auto-unlock strategy: complete this step and trigger reactive checking
      setTimeout(async () => {
        // Always complete this step after "Do it" action
        setIsLocallyCompleted(true);
        requirementsChecker.markCompleted();
        
        // Single reactive check with slight delay to ensure completion state is fully propagated
        setTimeout(() => {
          requirementsChecker.triggerReactiveCheck();
        }, 50); // Small delay to ensure completion state is propagated to manager
        
      }, 700); // Reduced delay for faster step unlocking
      
      if (onComplete) onComplete();
    } catch (error) {
      console.error('Interactive do action failed:', error);
    } finally {
      setIsDoRunning(false);
    }
  }, [targetAction, refTarget, targetValue, disabled, isDoRunning, isCompleted, onComplete, executeInteractiveAction, stepId, requirementsChecker]);

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
            disabled={disabled || isCompleted || isAnyActionRunning || !requirementsChecker.isEnabled}
            size="sm"
            variant="secondary"
            className="interactive-step-show-btn"
            title={
              requirementsChecker.isChecking ? 'Checking requirements...' :
              !requirementsChecker.isEnabled && requirementsChecker.explanation ? requirementsChecker.explanation :
              hints || `Show me: ${getActionDescription()}`
            }
          >
            {requirementsChecker.isChecking ? 'Checking...' :
             isShowRunning ? 'Showing...' : 
             !requirementsChecker.isEnabled ? 'Requirements not met' :
             'Show me'}
          </Button>
          
          <Button
            onClick={handleDoAction}
            disabled={disabled || isCompleted || isAnyActionRunning || !requirementsChecker.isEnabled}
            size="sm"
            variant="primary"
            className="interactive-step-do-btn"
            title={
              requirementsChecker.isChecking ? 'Checking requirements...' :
              !requirementsChecker.isEnabled && requirementsChecker.explanation ? requirementsChecker.explanation :
              hints || `Do it: ${getActionDescription()}`
            }
          >
            {requirementsChecker.isChecking ? 'Checking...' :
             isCompleted ? '✓ Completed' : 
             isDoRunning ? 'Doing...' : 
             !requirementsChecker.isEnabled ? 'Requirements not met' :
             'Do it'}
          </Button>
        </div>
        
        {isCompleted && <span className="interactive-step-completed-indicator">✓</span>}
      </div>
      
      {/* Show amber explanation text when requirements aren't met */}
      {!requirementsChecker.isEnabled && !isCompleted && !requirementsChecker.isChecking && requirementsChecker.explanation && (
        <div className="interactive-step-requirement-explanation" style={{ 
          color: '#ff8c00', 
          fontSize: '0.875rem', 
          marginTop: '8px',
          fontStyle: 'italic',
          lineHeight: '1.4',
          paddingLeft: '12px'
        }}>
          {requirementsChecker.explanation}
                     <button
             onClick={() => {
               requirementsChecker.checkRequirements();
             }}
            style={{
              marginLeft: '8px',
              padding: '2px 8px',
              fontSize: '0.75rem',
              border: '1px solid #ff8c00',
              background: 'transparent',
              color: '#ff8c00',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      )}
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

export function ContentParsingError({
  errors,
  warnings,
  fallbackHtml,
  onRetry,
  className,
}: ContentParsingErrorProps) {
  const [showDetails, setShowDetails] = useState(false);
  
  return (
    <div className={`content-parsing-error ${className || ''}`}>
      <Alert
        severity="error"
        title="Content Parsing Failed"
      >
        <p>
          The content could not be parsed into React components. This prevents interactive features from working properly.
        </p>
        
        <div className="error-summary">
          <strong>{errors.length} error(s) found:</strong>
          <ul>
            {errors.slice(0, 3).map((error, index) => (
              <li key={index}>
                <strong>{error.type}:</strong> {error.message}
                {error.location && <em> (at {error.location})</em>}
              </li>
            ))}
            {errors.length > 3 && (
              <li><em>... and {errors.length - 3} more errors</em></li>
            )}
          </ul>
        </div>

        {warnings && warnings.length > 0 && (
          <div className="warning-summary">
            <strong>{warnings.length} warning(s):</strong>
            <ul>
              {warnings.slice(0, 2).map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
              {warnings.length > 2 && (
                <li><em>... and {warnings.length - 2} more warnings</em></li>
              )}
            </ul>
          </div>
        )}

        <div className="error-actions">
          <Button 
            onClick={() => setShowDetails(!showDetails)} 
            variant="secondary" 
            size="sm"
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </Button>
          {onRetry && (
            <Button onClick={onRetry} variant="primary" size="sm">
              Retry Parsing
            </Button>
          )}
        </div>

        {showDetails && (
          <details className="error-details">
            <summary>Detailed Error Information</summary>
            {errors.map((error, index) => (
              <div key={index} className="error-detail">
                <h4>Error #{index + 1}: {error.type}</h4>
                <p><strong>Message:</strong> {error.message}</p>
                {error.location && <p><strong>Location:</strong> {error.location}</p>}
                {error.element && (
                  <details>
                    <summary>Problem Element</summary>
                    <pre><code>{error.element}</code></pre>
                  </details>
                )}
                {error.originalError && (
                  <p><strong>Original Error:</strong> {error.originalError.message}</p>
                )}
              </div>
            ))}
            
            {fallbackHtml && (
              <details>
                <summary>Original HTML Content</summary>
                <pre><code>{fallbackHtml.substring(0, 1000)}</code></pre>
                {fallbackHtml.length > 1000 && <p><em>... truncated</em></p>}
              </details>
            )}
          </details>
        )}
      </Alert>
    </div>
  );
}
