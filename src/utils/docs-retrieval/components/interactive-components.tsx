import React, { useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { IconButton, Button, Alert } from '@grafana/ui';
import { useInteractiveElements } from '../../interactive.hook';
import { useStepRequirements } from '../../step-requirements.hook';
import { ParseError } from '../content.types';

// Simple counter for sequential section IDs
let interactiveSectionCounter = 0;

// Function to reset counters (can be called when new content loads)
export function resetInteractiveCounters() {
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
  
  // New unified state management props (added by parent)
  stepId?: string;
  isEligibleForChecking?: boolean;
  isCompleted?: boolean;
  isCurrentlyExecuting?: boolean;
  onStepComplete?: (stepId: string) => void;
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
  content?: string; // Made optional since we might pass children instead
  defaultCollapsed?: boolean;
  toggleText?: string;
  className?: string;
  children?: React.ReactNode; // Add children support
  isCollapseSection?: boolean; // Flag to identify collapse sections
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

// --- Types for unified state management ---
interface StepInfo {
  stepId: string;
  element: React.ReactElement<InteractiveStepProps>;
  index: number;
  targetAction: string;
  refTarget: string;
  targetValue?: string;
  requirements?: string;
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
    // Handle both camelCase dataSrc and kebab-case data-src
    const imgSrc = src || dataSrc || (props as any)['data-src'];
    if (!imgSrc) {
      console.error('ImageRenderer: No image source found', { src, dataSrc, 'data-src': (props as any)['data-src'] });
      return undefined;
    }
    if (!baseUrl) {
      console.warn('ImageRenderer: No baseUrl provided, using relative URL', { imgSrc });
      return imgSrc;
    }
    if (imgSrc.startsWith('/') && !imgSrc.startsWith('//')) {
      const resolved = new URL(imgSrc, baseUrl).href;
      return resolved;
    }
    return imgSrc;
  }, [src, dataSrc, baseUrl, props]);

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
  // Generate simple sequential section ID
  const sectionId = useMemo(() => {
    interactiveSectionCounter++;
    return `section-${interactiveSectionCounter}`;
  }, []);

  // Sequential state management
  const [completedSteps, setCompletedSteps] = useState(new Set<string>());
  const [currentlyExecutingStep, setCurrentlyExecutingStep] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Get the interactive functions from the hook
  const { executeInteractiveAction } = useInteractiveElements();

  // Extract step information from children
  const stepComponents = useMemo((): StepInfo[] => {
    const steps: StepInfo[] = [];
    
    React.Children.forEach(children, (child, index) => {
      if (React.isValidElement(child) && 
          (child as any).type === InteractiveStep &&
          child.props && 
          typeof child.props === 'object') {
        const props = child.props as InteractiveStepProps;
        const stepId = `${sectionId}-step-${index + 1}`;
        
        steps.push({
          stepId,
          element: child as React.ReactElement<InteractiveStepProps>,
          index,
          targetAction: props.targetAction,
          refTarget: props.refTarget,
          targetValue: props.targetValue,
          requirements: props.requirements,
        });
      }
    });
    
    return steps;
  }, [children, sectionId]);

  // Calculate which step is eligible for checking (sequential logic)
  const getStepEligibility = useCallback((stepIndex: number) => {
    // First step is always eligible (Trust but Verify)
    if (stepIndex === 0) return true;
    
    // Subsequent steps are eligible if all previous steps are completed
    for (let i = 0; i < stepIndex; i++) {
      const prevStepId = stepComponents[i].stepId;
      if (!completedSteps.has(prevStepId)) {
        return false;
      }
    }
    return true;
  }, [completedSteps, stepComponents]);

  // Handle individual step completion
  const handleStepComplete = useCallback((stepId: string) => {
    console.log(`🎯 Step completed: ${stepId}`);
    setCompletedSteps(prev => new Set([...prev, stepId]));
    setCurrentlyExecutingStep(null);
    
    // Check if all steps are completed
    if (completedSteps.size + 1 >= stepComponents.length) {
      console.log(`🏁 Section completed: ${sectionId}`);
      onComplete?.();
    }
  }, [completedSteps.size, stepComponents.length, sectionId, onComplete]);

  // Execute a single step (shared between individual and sequence execution)
  const executeStep = useCallback(async (stepInfo: StepInfo): Promise<boolean> => {
    console.log(`🚀 Executing step: ${stepInfo.stepId} (${stepInfo.targetAction}: ${stepInfo.refTarget})`);
    
    try {
      // Execute the action using existing interactive logic
      await executeInteractiveAction(
        stepInfo.targetAction,
        stepInfo.refTarget,
        stepInfo.targetValue,
        'do'
      );
      
      return true;
    } catch (error) {
      console.error(`❌ Step execution failed: ${stepInfo.stepId}`, error);
      return false;
    }
  }, [executeInteractiveAction]);

  // Handle sequence execution (do section)
  const handleDoSection = useCallback(async () => {
    if (disabled || isRunning || stepComponents.length === 0) {
      return;
    }

    console.log(`🚀 Starting section sequence: ${sectionId} (${stepComponents.length} steps)`);
    setIsRunning(true);
    
    // Reset completion state for re-runs
    setCompletedSteps(new Set());

    try {
      for (let i = 0; i < stepComponents.length; i++) {
        const stepInfo = stepComponents[i];
        setCurrentlyExecutingStep(stepInfo.stepId);

        // First, show the step (highlight it)
        console.log(`👁️ Showing step: ${stepInfo.stepId}`);
        await executeInteractiveAction(
          stepInfo.targetAction,
          stepInfo.refTarget,
          stepInfo.targetValue,
          'show'
        );

        // Wait for highlight to be visible
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Then, execute the step
        const success = await executeStep(stepInfo);
        
        if (success) {
          // Mark step as completed
          handleStepComplete(stepInfo.stepId);
          
          // Wait between steps for visual feedback
          if (i < stepComponents.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } else {
          console.warn(`⚠️ Breaking section sequence at step ${i + 1} due to execution failure`);
          break;
        }
      }

      console.log(`🏁 Section sequence completed: ${sectionId}`);
    } catch (error) {
      console.error('Error running section sequence:', error);
    } finally {
      setIsRunning(false);
      setCurrentlyExecutingStep(null);
    }
  }, [disabled, isRunning, stepComponents, sectionId, executeStep, executeInteractiveAction, handleStepComplete]);

  // Render enhanced children with coordination props
  const enhancedChildren = useMemo(() => {
    return React.Children.map(children, (child, index) => {
      if (React.isValidElement(child) && 
          (child as any).type === InteractiveStep) {
        const stepInfo = stepComponents[index];
        if (!stepInfo) return child;
        
        const isEligibleForChecking = getStepEligibility(index);
        const isCompleted = completedSteps.has(stepInfo.stepId);
        const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;
        
        return React.cloneElement(child as React.ReactElement<InteractiveStepProps>, {
          ...child.props,
          stepId: stepInfo.stepId,
          isEligibleForChecking,
          isCompleted,
          isCurrentlyExecuting,
          onStepComplete: handleStepComplete,
          disabled: disabled || isRunning,
          key: stepInfo.stepId,
        });
      }
      return child;
    });
  }, [children, stepComponents, getStepEligibility, completedSteps, currentlyExecutingStep, handleStepComplete, disabled, isRunning]);

  // Calculate section completion status
  const isCompleted = stepComponents.length > 0 && completedSteps.size >= stepComponents.length;

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
        {enhancedChildren}
      </div>
      
      <div className="interactive-section-actions">
        <Button
          onClick={handleDoSection}
          disabled={disabled || isRunning || stepComponents.length === 0}
          size="md"
          variant={isCompleted ? "secondary" : "primary"}
          className="interactive-section-do-button"
          title={
            isCompleted ? 'Run the section again' :
            isRunning ? `Running Step ${currentlyExecutingStep ? stepComponents.findIndex(s => s.stepId === currentlyExecutingStep) + 1 : '?'}/${stepComponents.length}...` :
            hints || `Run through all ${stepComponents.length} steps in sequence`
          }
        >
          {isCompleted ? `Redo Section (${stepComponents.length} steps)` :
           isRunning ? `Running Step ${currentlyExecutingStep ? stepComponents.findIndex(s => s.stepId === currentlyExecutingStep) + 1 : '?'}/${stepComponents.length}...` : 
           `Do Section (${stepComponents.length} steps)`}
        </Button>
      </div>
    </div>
  );
}

export const InteractiveStep = forwardRef<
  { executeStep: () => Promise<boolean> },
  InteractiveStepProps
>(({
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
  // New unified state management props (passed by parent)
  stepId,
  isEligibleForChecking = true,
  isCompleted: parentCompleted = false,
  isCurrentlyExecuting = false,
  onStepComplete,
}, ref) => {
  // Local UI state
  const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
  const [isShowRunning, setIsShowRunning] = useState(false);
  const [isDoRunning, setIsDoRunning] = useState(false);
  
  // Combined completion state (parent takes precedence for coordination)
  const isCompleted = parentCompleted || isLocallyCompleted;
  
  // Get the interactive functions from the hook
  const { executeInteractiveAction } = useInteractiveElements();
  
  // Use the new step requirements hook with parent coordination
  const requirementsChecker = useStepRequirements({
    requirements,
    hints,
    stepId: stepId || `step-${Date.now()}`, // Fallback if no stepId provided
    isEligibleForChecking: isEligibleForChecking && !isCompleted
  });
  
  // Execution logic (shared between individual and sequence execution)
  const executeStep = useCallback(async (): Promise<boolean> => {
    if (!requirementsChecker.isEnabled || isCompleted || disabled) {
      console.warn(`⚠️ Step execution blocked: ${stepId}`, {
        enabled: requirementsChecker.isEnabled,
        completed: isCompleted,
        disabled
      });
      return false;
    }
    
    try {
      console.log(`🚀 Executing step: ${stepId} (${targetAction}: ${refTarget})`);
      
      // Execute the action using existing interactive logic
      await executeInteractiveAction(targetAction, refTarget, targetValue, 'do');
      
      // Mark as completed locally and notify parent
      setIsLocallyCompleted(true);
      
      // Notify parent if we have the callback (section coordination)
      if (onStepComplete && stepId) {
        onStepComplete(stepId);
      }
      
      // Call the original onComplete callback if provided
      if (onComplete) {
        onComplete();
      }
      
      console.log(`✅ Step completed: ${stepId}`);
      return true;
    } catch (error) {
      console.error(`❌ Step execution failed: ${stepId}`, error);
      return false;
    }
  }, [
    requirementsChecker.isEnabled,
    isCompleted,
    disabled,
    stepId,
    targetAction,
    refTarget,
    targetValue,
    executeInteractiveAction,
    onStepComplete,
    onComplete
  ]);
  
  // Expose execute method for parent (sequence execution)
  useImperativeHandle(ref, () => ({
    executeStep
  }), [executeStep]);
  
  // Handle individual "Show me" action
  const handleShowAction = useCallback(async () => {
    if (disabled || isShowRunning || isCompleted || !requirementsChecker.isEnabled) {
      return;
    }
    
    setIsShowRunning(true);
    try {
      await executeInteractiveAction(targetAction, refTarget, targetValue, 'show');
    } catch (error) {
      console.error('Interactive show action failed:', error);
    } finally {
      setIsShowRunning(false);
    }
  }, [targetAction, refTarget, targetValue, disabled, isShowRunning, isCompleted, requirementsChecker.isEnabled, executeInteractiveAction]);
  
  // Handle individual "Do it" action (delegates to executeStep)
  const handleDoAction = useCallback(async () => {
    if (disabled || isDoRunning || isCompleted || !requirementsChecker.isEnabled) {
      return;
    }
    
    setIsDoRunning(true);
    try {
      await executeStep();
    } catch (error) {
      console.error('Interactive do action failed:', error);
    } finally {
      setIsDoRunning(false);
    }
  }, [disabled, isDoRunning, isCompleted, requirementsChecker.isEnabled, executeStep]);
  
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
  
  const isAnyActionRunning = isShowRunning || isDoRunning || isCurrentlyExecuting;
  
  return (
    <div className={`interactive-step${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}${isCurrentlyExecuting ? ' executing' : ''}`}>
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
              hints || `Show me: ${getActionDescription()}`
            }
          >
            {requirementsChecker.isChecking ? 'Checking...' :
             isShowRunning ? 'Showing...' : 
             !requirementsChecker.isEnabled && !isCompleted ? 'Requirements not met' :
             'Show me'}
          </Button>
          
          { 
            // Only show the do it button if the step is eligible or already completed.
            // If the requirements have not been met, don't give them the option, and don't
            // duplicate the "Requirements not met" text above.
            (requirementsChecker.isEnabled || isCompleted) && (
              <Button
              onClick={handleDoAction}
              disabled={disabled || isCompleted || isAnyActionRunning || !requirementsChecker.isEnabled}
              size="sm"
              variant="primary"
              className="interactive-step-do-btn"
              title={
                requirementsChecker.isChecking ? 'Checking requirements...' :
                hints || `Do it: ${getActionDescription()}`
              }
            >
              {requirementsChecker.isChecking ? 'Checking...' :
              isCompleted ? '✓ Completed' : 
              isDoRunning || isCurrentlyExecuting ? 'Executing...' : 
              'Do it'}
            </Button>
          )}
        </div>
        
        {isCompleted && <span className="interactive-step-completed-indicator">✓</span>}
      </div>
      
      {/* Show explanation text when requirements aren't met */}
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
});

// Add display name for debugging
InteractiveStep.displayName = 'InteractiveStep';

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
  children,
  isCollapseSection = false,
}: ExpandableTableProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  // If this is a collapse section, render with the proper CSS structure
  if (isCollapseSection) {
    return (
      <div className={`journey-collapse${className ? ` ${className}` : ''}`}>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="journey-collapse-trigger"
          type="button"
        >
          <span>{toggleText || 'Toggle section'}</span>
          <span className={`journey-collapse-icon${isCollapsed ? ' collapsed' : ''}`}>
            ▼
          </span>
        </button>
        {!isCollapsed && (
          <div className="journey-collapse-content">
            {children ? (
              children
            ) : content ? (
              <div dangerouslySetInnerHTML={{ __html: content }} />
            ) : null}
          </div>
        )}
      </div>
    );
  }

  // Original expandable table implementation for other cases
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
        {children ? (
          children
        ) : content ? (
          <div dangerouslySetInnerHTML={{ __html: content }} />
        ) : null}
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
