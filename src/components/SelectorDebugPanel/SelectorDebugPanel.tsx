import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Input, Badge, Icon, useStyles2, TextArea } from '@grafana/ui';
import { useInteractiveElements } from '../../utils/interactive.hook';
import { querySelectorAllEnhanced } from '../../utils/enhanced-selector';
import { generateBestSelector, getSelectorInfo } from '../../utils/selector-generator';
import {
  detectActionType,
  shouldCaptureElement,
  getActionDescription,
  type DetectedAction,
} from '../../utils/action-detector';
import { getDebugPanelStyles } from './debug-panel.styles';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { exportStepsToHTML, combineStepsIntoMultistep, type RecordedStep } from '../../utils/tutorial-exporter';
import { validateAndCleanSelector } from '../../utils/selector-validator';
import { validateAndParseGitHubUrl } from '../../utils/github-url-validator';
import { disableDevMode } from '../../utils/dev-mode';

interface TestResult {
  success: boolean;
  message: string;
  matchCount?: number;
}

// RecordedStep interface is now imported from tutorial-exporter

export interface SelectorDebugPanelProps {
  onOpenDocsPage?: (url: string, title: string) => void;
}

export function SelectorDebugPanel({ onOpenDocsPage }: SelectorDebugPanelProps = {}) {
  const styles = useStyles2(getDebugPanelStyles);
  const { executeInteractiveAction } = useInteractiveElements();

  // Section expansion state
  const [simpleExpanded, setSimpleExpanded] = useState(false);
  const [multiStepExpanded, setMultiStepExpanded] = useState(false);
  const [guidedExpanded, setGuidedExpanded] = useState(false);
  const [watchExpanded, setWatchExpanded] = useState(false);
  const [recordExpanded, setRecordExpanded] = useState(false);
  const [githubExpanded, setGithubExpanded] = useState(false);

  // Handle leaving dev mode
  const handleLeaveDevMode = useCallback(() => {
    if (window.confirm('Exit dev mode? The debug panel will be hidden until you re-enable it in settings.')) {
      disableDevMode();
      window.location.reload(); // Reload to apply the change
    }
  }, []);

  // Simple Selector Tester State
  const [simpleSelector, setSimpleSelector] = useState('');
  const [simpleResult, setSimpleResult] = useState<TestResult | null>(null);
  const [simpleTesting, setSimpleTesting] = useState(false);

  // MultiStep Debug State (auto-execution)
  const [multiStepInput, setMultiStepInput] = useState('');
  const [multiStepResult, setMultiStepResult] = useState<TestResult | null>(null);
  const [multiStepTesting, setMultiStepTesting] = useState(false);
  const [multiStepProgress, setMultiStepProgress] = useState<{ current: number; total: number } | null>(null);

  // Guided Debug State (user performs actions manually)
  const [guidedInput, setGuidedInput] = useState('');
  const [guidedResult, setGuidedResult] = useState<TestResult | null>(null);
  const [guidedRunning, setGuidedRunning] = useState(false);
  const [guidedCurrentStep, setGuidedCurrentStep] = useState(0);
  const [guidedSteps, setGuidedSteps] = useState<Array<{ action: string; selector: string; value?: string }>>([]);
  const guidedAbortControllerRef = useRef<AbortController | null>(null);

  // Guided Debug Handlers
  const handleGuidedStart = useCallback(async () => {
    if (!guidedInput.trim()) {
      setGuidedResult({ success: false, message: 'Please enter guided steps' });
      return;
    }

    // Parse input lines
    const lines = guidedInput.split('\n').filter((line) => line.trim());
    const steps: Array<{ action: string; selector: string; value?: string }> = [];

    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length >= 2) {
        steps.push({
          action: parts[0],
          selector: parts[1],
          value: parts[2] || undefined,
        });
      }
    }

    if (steps.length === 0) {
      setGuidedResult({ success: false, message: 'No valid steps found in input' });
      return;
    }

    setGuidedSteps(steps);
    setGuidedRunning(true);
    setGuidedCurrentStep(0);
    setGuidedResult(null);

    // Create abort controller for cancellation
    guidedAbortControllerRef.current = new AbortController();

    try {
      // Execute steps one at a time, waiting for user action
      for (let i = 0; i < steps.length; i++) {
        if (guidedAbortControllerRef.current?.signal.aborted) {
          break;
        }

        const step = steps[i];
        setGuidedCurrentStep(i);

        // Highlight the element and wait for user to perform the action
        await executeInteractiveAction(step.action, step.selector, step.value, 'show');

        // Wait for user to complete the action
        // This is a simplified version - in production, you'd use GuidedHandler's completion detection
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            resolve(undefined);
          }, 30000); // 30 second timeout per step

          if (guidedAbortControllerRef.current) {
            guidedAbortControllerRef.current.signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new Error('Cancelled'));
            });
          }

          // Listen for completion (simplified - just wait for any click near the highlighted element)
          const handleCompletion = () => {
            clearTimeout(timeout);
            document.removeEventListener('click', handleCompletion);
            resolve(undefined);
          };

          // Wait a bit before adding listener to avoid immediate trigger
          setTimeout(() => {
            document.addEventListener('click', handleCompletion, { once: true });
          }, 500);
        });
      }

      setGuidedResult({
        success: true,
        message: `Completed ${steps.length} guided step${steps.length !== 1 ? 's' : ''}`,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Cancelled') {
        setGuidedResult({ success: false, message: 'Guided sequence cancelled' });
      } else {
        setGuidedResult({
          success: false,
          message: error instanceof Error ? error.message : 'Guided execution failed',
        });
      }
    } finally {
      setGuidedRunning(false);
      setGuidedCurrentStep(0);
      guidedAbortControllerRef.current = null;
    }
  }, [guidedInput, executeInteractiveAction]);

  const handleGuidedCancel = useCallback(() => {
    if (guidedAbortControllerRef.current) {
      guidedAbortControllerRef.current.abort();
    }
  }, []);

  // Watch Mode State
  const [watchMode, setWatchMode] = useState(false);
  const [capturedSelector, setCapturedSelector] = useState('');
  const [selectorInfo, setSelectorInfo] = useState<{
    method: string;
    isUnique: boolean;
    matchCount: number;
    contextStrategy?: string;
  } | null>(null);
  const [selectorCopied, setSelectorCopied] = useState(false);

  // Record Mode State
  const [recordMode, setRecordMode] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState<RecordedStep[]>([]);
  const recordingElementsRef = useRef<Map<HTMLElement, { value: string; timestamp: number }>>(new Map());
  const [allStepsCopied, setAllStepsCopied] = useState(false);

  // Export State
  const [exportCopied, setExportCopied] = useState(false);

  // Multistep Selection State
  const [selectedSteps, setSelectedSteps] = useState<Set<number>>(new Set());
  const [multistepMode, setMultistepMode] = useState(false);

  // GitHub Tutorial Tester State
  const [githubUrl, setGithubUrl] = useState('');
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubSuccess, setGithubSuccess] = useState(false);

  // Simple Selector Tester Handlers
  const handleSimpleShow = useCallback(async () => {
    if (!simpleSelector.trim()) {
      setSimpleResult({ success: false, message: 'Please enter a selector' });
      return;
    }

    setSimpleTesting(true);
    setSimpleResult(null);

    try {
      const result = querySelectorAllEnhanced(simpleSelector);
      const matchCount = result.elements.length;

      if (matchCount === 0) {
        setSimpleResult({
          success: false,
          message: 'No elements found',
          matchCount: 0,
        });
      } else {
        // Highlight all matches using the highlight action
        await executeInteractiveAction('highlight', simpleSelector, undefined, 'show');
        setSimpleResult({
          success: true,
          message: `Found ${matchCount} element${matchCount !== 1 ? 's' : ''}${result.usedFallback ? ' (using fallback)' : ''}`,
          matchCount,
        });
      }
    } catch (error) {
      setSimpleResult({
        success: false,
        message: error instanceof Error ? error.message : 'Selector test failed',
      });
    } finally {
      setSimpleTesting(false);
    }
  }, [simpleSelector, executeInteractiveAction]);

  const handleSimpleDo = useCallback(async () => {
    if (!simpleSelector.trim()) {
      setSimpleResult({ success: false, message: 'Please enter a selector' });
      return;
    }

    setSimpleTesting(true);
    setSimpleResult(null);

    try {
      const result = querySelectorAllEnhanced(simpleSelector);
      const matchCount = result.elements.length;

      if (matchCount === 0) {
        setSimpleResult({
          success: false,
          message: 'No elements found',
          matchCount: 0,
        });
      } else {
        // Highlight and click first match
        await executeInteractiveAction('highlight', simpleSelector, undefined, 'do');
        setSimpleResult({
          success: true,
          message: `Clicked first of ${matchCount} element${matchCount !== 1 ? 's' : ''}${result.usedFallback ? ' (using fallback)' : ''}`,
          matchCount,
        });
      }
    } catch (error) {
      setSimpleResult({
        success: false,
        message: error instanceof Error ? error.message : 'Selector action failed',
      });
    } finally {
      setSimpleTesting(false);
    }
  }, [simpleSelector, executeInteractiveAction]);

  // MultiStep Debug Handlers
  const handleMultiStepRun = useCallback(async () => {
    if (!multiStepInput.trim()) {
      setMultiStepResult({ success: false, message: 'Please enter steps' });
      return;
    }

    setMultiStepTesting(true);
    setMultiStepResult(null);
    setMultiStepProgress(null);

    try {
      // Parse input lines
      const lines = multiStepInput.split('\n').filter((line) => line.trim());
      const steps: Array<{ action: string; selector: string; value?: string }> = [];

      for (const line of lines) {
        const parts = line.split('|').map((p) => p.trim());
        if (parts.length >= 2) {
          steps.push({
            action: parts[0],
            selector: parts[1],
            value: parts[2] || undefined,
          });
        }
      }

      if (steps.length === 0) {
        setMultiStepResult({ success: false, message: 'No valid steps found in input' });
        setMultiStepTesting(false);
        return;
      }

      // Execute steps sequentially with show→delay→do pattern
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        setMultiStepProgress({ current: i + 1, total: steps.length });

        // Show phase
        await executeInteractiveAction(step.action, step.selector, step.value, 'show');

        // Delay between show and do
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            INTERACTIVE_CONFIG.delays.multiStep.showToDoIterations * INTERACTIVE_CONFIG.delays.multiStep.baseInterval
          )
        );

        // Do phase
        await executeInteractiveAction(step.action, step.selector, step.value, 'do');

        // Delay between steps (except after last step)
        if (i < steps.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.multiStep.defaultStepDelay));
        }
      }

      setMultiStepResult({
        success: true,
        message: `Successfully executed ${steps.length} step${steps.length !== 1 ? 's' : ''}`,
      });
      setMultiStepProgress(null);
    } catch (error) {
      setMultiStepResult({
        success: false,
        message: error instanceof Error ? error.message : 'MultiStep execution failed',
      });
      setMultiStepProgress(null);
    } finally {
      setMultiStepTesting(false);
    }
  }, [multiStepInput, executeInteractiveAction]);

  // Watch Mode Handlers
  const handleWatchModeToggle = useCallback(() => {
    setWatchMode((prev) => !prev);
    if (watchMode) {
      // Turning off - clear captured selector
      setCapturedSelector('');
      setSelectorInfo(null);
    }
  }, [watchMode]);

  const handleCopySelector = useCallback(async () => {
    if (capturedSelector) {
      try {
        await navigator.clipboard.writeText(capturedSelector);
        setSelectorCopied(true);
        // Reset after 2 seconds
        setTimeout(() => setSelectorCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy selector:', error);
      }
    }
  }, [capturedSelector]);

  const handleUseInSimpleTester = useCallback(() => {
    setSimpleSelector(capturedSelector);
    setSimpleExpanded(true);
    // Always turn off watch mode after using selector
    setWatchMode(false);
    setCapturedSelector('');
    setSelectorInfo(null);
  }, [capturedSelector]);

  // Watch Mode click listener
  useEffect(() => {
    if (!watchMode) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Don't capture clicks within the debug panel
      if (target.closest('[class*="debug"]') || target.closest('.context-container')) {
        return;
      }

      // DON'T preventDefault - let the click proceed normally!
      // Just capture the selector and let navigation/actions happen

      // Use same mechanics as record mode: coordinates + validation
      const clickX = event.clientX;
      const clickY = event.clientY;

      let selector = generateBestSelector(target, { clickX, clickY });
      let action = detectActionType(target, event);

      // Apply same logic as record mode for action type
      const isPlainText =
        !selector.includes('[') && !selector.includes('.') && !selector.includes('#') && !selector.includes(':');
      if (isPlainText) {
        action = 'button';
      } else if (action === 'button') {
        action = 'highlight';
      }

      // FINAL VALIDATION: Apply all quality rules
      const validated = validateAndCleanSelector(selector, action);
      selector = validated.selector;

      if (validated.warnings.length > 0) {
        console.warn('Watch mode selector validation warnings:', validated.warnings);
      }

      const info = getSelectorInfo(target);

      setCapturedSelector(selector);
      setSelectorInfo({
        method: info.method,
        isUnique: info.isUnique,
        matchCount: info.matchCount,
      });

      // Auto-disable watch mode after capturing to preserve the selector
      setWatchMode(false);
    };

    // Use capture phase but don't prevent default
    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  }, [watchMode]);

  // Record Mode Handlers
  const handleRecordModeToggle = useCallback(() => {
    setRecordMode((prev) => !prev);
    if (recordMode) {
      // Turning off - keep recorded steps
    } else {
      // Turning on - clear previous recordings if any
      recordingElementsRef.current.clear();
    }
  }, [recordMode]);

  const handleClearRecording = useCallback(() => {
    setRecordedSteps([]);
    recordingElementsRef.current.clear();
  }, []);

  const handleCopyAllSteps = useCallback(async () => {
    const stepsText = recordedSteps
      .map((step) => {
        const valuePart = step.value ? `|${step.value}` : '|';
        return `${step.action}|${step.selector}${valuePart}`;
      })
      .join('\n');

    try {
      await navigator.clipboard.writeText(stepsText);
      setAllStepsCopied(true);
      // Reset after 2 seconds
      setTimeout(() => setAllStepsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy steps:', error);
    }
  }, [recordedSteps]);

  const handleLoadIntoMultiStep = useCallback(() => {
    const stepsText = recordedSteps
      .map((step) => {
        const valuePart = step.value ? `|${step.value}` : '|';
        return `${step.action}|${step.selector}${valuePart}`;
      })
      .join('\n');

    setMultiStepInput(stepsText);
    setMultiStepExpanded(true);
  }, [recordedSteps]);

  const handleDeleteStep = useCallback((index: number) => {
    setRecordedSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleExportHTML = useCallback(async () => {
    const html = exportStepsToHTML(recordedSteps, {
      includeComments: true,
      includeHints: true,
      wrapInSection: true,
      sectionId: 'tutorial-section',
      sectionTitle: 'Tutorial Section',
    });

    try {
      await navigator.clipboard.writeText(html);
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy HTML:', error);
    }
  }, [recordedSteps]);

  const handleToggleStepSelection = useCallback((index: number) => {
    setSelectedSteps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  }, []);

  const handleCombineSteps = useCallback(() => {
    if (selectedSteps.size < 2) {
      return;
    }

    const description = 'Combined steps';
    const newSteps = combineStepsIntoMultistep(recordedSteps, Array.from(selectedSteps), description);

    setRecordedSteps(newSteps);
    setSelectedSteps(new Set());
    setMultistepMode(false);
  }, [selectedSteps, recordedSteps]);

  const handleToggleMultistepMode = useCallback(() => {
    if (multistepMode) {
      // Turning off - clear selections
      setSelectedSteps(new Set());
    }
    setMultistepMode(!multistepMode);
  }, [multistepMode]);

  // GitHub Tutorial Tester Handler
  const handleTestGithubTutorial = useCallback(() => {
    const validation = validateAndParseGitHubUrl(githubUrl);

    if (!validation.isValid) {
      setGithubError(validation.errorMessage || 'Invalid URL format');
      setGithubSuccess(false);
      return;
    }

    if (!onOpenDocsPage) {
      setGithubError('Tab opening is not available');
      return;
    }

    // Open in new tab with tutorial name as title
    onOpenDocsPage(validation.cleanedUrl!, validation.tutorialName!);
    setGithubSuccess(true);
    setGithubError(null);

    // Reset success state after 2 seconds
    setTimeout(() => setGithubSuccess(false), 2000);
  }, [githubUrl, onOpenDocsPage]);

  // Record Mode event listeners
  useEffect(() => {
    if (!recordMode) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (!shouldCaptureElement(target)) {
        return;
      }

      // DON'T preventDefault - let the click proceed normally!
      // Just record the action and let navigation/actions happen

      // Capture click coordinates for coordinate-aware selector generation
      const clickX = event.clientX;
      const clickY = event.clientY;

      let selector = generateBestSelector(target, { clickX, clickY });
      let action = detectActionType(target, event);

      // If selector is plain text (no CSS syntax), force button action for text-based matching
      // Otherwise, use highlight with the CSS selector
      const isPlainText =
        !selector.includes('[') && !selector.includes('.') && !selector.includes('#') && !selector.includes(':');
      if (isPlainText) {
        // Plain text selector - use button action for text matching
        action = 'button';
      } else if (action === 'button') {
        // Has CSS selector - use highlight instead of button
        action = 'highlight';
      }

      // FINAL VALIDATION: Apply all quality rules as a safety net
      const validated = validateAndCleanSelector(selector, action);
      selector = validated.selector;
      // Only use validated action if it's a valid DetectedAction
      const validDetectedActions: DetectedAction[] = ['highlight', 'button', 'formfill', 'navigate', 'hover'];
      if (validDetectedActions.includes(validated.action as DetectedAction)) {
        action = validated.action as DetectedAction;
      }

      // Log validation warnings for debugging
      if (validated.warnings.length > 0) {
        console.warn('Selector validation warnings:', validated.warnings);
      }

      const selectorInfo = getSelectorInfo(target);
      const description = getActionDescription(action, target);

      // For text form elements, track them but don't record yet (wait for value)
      // Radio/checkbox use 'highlight' action and are recorded immediately, not tracked
      if (action === 'formfill') {
        recordingElementsRef.current.set(target, {
          value: (target as HTMLInputElement).value || '',
          timestamp: Date.now(),
        });
        return;
      }

      // Check for duplicate - don't record if last step has same selector and action
      setRecordedSteps((prev) => {
        const lastStep = prev.length > 0 ? prev[prev.length - 1] : null;
        if (lastStep && lastStep.selector === selector && lastStep.action === action) {
          console.warn('Skipping duplicate selector:', selector);
          return prev; // Skip duplicate
        }

        // For other actions, record immediately
        return [
          ...prev,
          {
            action,
            selector,
            value: undefined,
            description: validated.wasModified ? `${description} ⚠️ (cleaned)` : description,
            isUnique: selectorInfo.isUnique,
            matchCount: selectorInfo.matchCount,
            contextStrategy: selectorInfo.contextStrategy,
          },
        ];
      });
    };

    const handleInput = (event: Event) => {
      const target = event.target as HTMLElement;

      if (!shouldCaptureElement(target)) {
        return;
      }

      // Skip tracking radio/checkbox inputs - they're handled on click
      const inputElement = target as HTMLInputElement;
      if (inputElement.type === 'radio' || inputElement.type === 'checkbox') {
        return;
      }

      // Update the tracked value for text inputs
      recordingElementsRef.current.set(target, {
        value: inputElement.value || '',
        timestamp: Date.now(),
      });
    };

    const handleChange = (event: Event) => {
      const target = event.target as HTMLElement;

      if (!shouldCaptureElement(target)) {
        return;
      }

      const tracked = recordingElementsRef.current.get(target);
      if (tracked) {
        let selector = generateBestSelector(target);
        let action = detectActionType(target, event);

        // Skip recording radio/checkbox change events - they're already recorded on click
        if (action === 'highlight') {
          recordingElementsRef.current.delete(target);
          return;
        }

        // FINAL VALIDATION: Apply all quality rules
        const validated = validateAndCleanSelector(selector, action);
        selector = validated.selector;
        // Only use validated action if it's a valid DetectedAction
        const validDetectedActions: DetectedAction[] = ['highlight', 'button', 'formfill', 'navigate', 'hover'];
        if (validDetectedActions.includes(validated.action as DetectedAction)) {
          action = validated.action as DetectedAction;
        }

        // Log validation warnings for debugging
        if (validated.warnings.length > 0) {
          console.warn('Selector validation warnings:', validated.warnings);
        }

        const selectorInfo = getSelectorInfo(target);
        const description = getActionDescription(action, target);

        // Check for duplicate - don't record if last step has same selector, action, and value
        setRecordedSteps((prev) => {
          const lastStep = prev.length > 0 ? prev[prev.length - 1] : null;
          if (
            lastStep &&
            lastStep.selector === selector &&
            lastStep.action === action &&
            lastStep.value === tracked.value
          ) {
            console.warn('Skipping duplicate formfill:', selector);
            recordingElementsRef.current.delete(target);
            return prev; // Skip duplicate
          }

          // Record the form fill action
          recordingElementsRef.current.delete(target);
          return [
            ...prev,
            {
              action,
              selector,
              value: tracked.value,
              description: validated.wasModified ? `${description} ⚠️ (cleaned)` : description,
              isUnique: selectorInfo.isUnique,
              matchCount: selectorInfo.matchCount,
              contextStrategy: selectorInfo.contextStrategy,
            },
          ];
        });
      }
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleChange, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('change', handleChange, true);
    };
  }, [recordMode]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Icon name="bug" size="lg" />
          <h3 className={styles.title}>DOM Selector Debug</h3>
          <Badge text="Dev Mode" color="orange" className={styles.badge} />
        </div>
        <Button variant="secondary" size="sm" onClick={handleLeaveDevMode} icon="times">
          Leave Dev Mode
        </Button>
      </div>

      {/* Simple Selector Tester */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setSimpleExpanded(!simpleExpanded)}>
          <h4 className={styles.sectionTitle}>Simple Selector Tester</h4>
          <Icon name={simpleExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {simpleExpanded && (
          <div className={styles.sectionContent}>
            <div className={styles.formGroup}>
              <label className={styles.label}>CSS Selector (supports :contains, :has, :nth-match)</label>
              <Input
                className={styles.selectorInput}
                value={simpleSelector}
                onChange={(e) => setSimpleSelector(e.currentTarget.value)}
                placeholder='button[data-testid="save-button"]'
                disabled={simpleTesting}
              />
              <div className={styles.buttonGroup}>
                <Button variant="secondary" size="sm" onClick={handleSimpleShow} disabled={simpleTesting}>
                  {simpleTesting ? 'Testing...' : 'Show me'}
                </Button>
                <Button variant="primary" size="sm" onClick={handleSimpleDo} disabled={simpleTesting}>
                  {simpleTesting ? 'Testing...' : 'Do it'}
                </Button>
              </div>
              {simpleResult && (
                <div
                  className={`${styles.resultBox} ${simpleResult.success ? styles.resultSuccess : styles.resultError}`}
                >
                  <p className={styles.resultText}>
                    {simpleResult.success && <Icon name="check" />} {simpleResult.message}
                  </p>
                  {simpleResult.matchCount !== undefined && simpleResult.matchCount > 0 && (
                    <span className={styles.matchCount}>
                      <Icon name="crosshair" size="sm" />
                      {simpleResult.matchCount} match{simpleResult.matchCount !== 1 ? 'es' : ''}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MultiStep Debug (renamed from Do Section) */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setMultiStepExpanded(!multiStepExpanded)}>
          <h4 className={styles.sectionTitle}>MultiStep Debug (Auto-Execute)</h4>
          <Icon name={multiStepExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {multiStepExpanded && (
          <div className={styles.sectionContent}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Steps (one per line: action|selector|value)</label>
              <TextArea
                className={styles.textArea}
                value={multiStepInput}
                onChange={(e) => setMultiStepInput(e.currentTarget.value)}
                placeholder="highlight|button[data-testid='save']|&#10;formfill|input[name='query']|prometheus&#10;button|Save Dashboard|"
                disabled={multiStepTesting}
              />
              <p className={styles.helpText}>
                Format: <code className={styles.exampleCode}>action|selector|value</code>
                <br />
                Example: <code className={styles.exampleCode}>formfill|input[name=&quot;query&quot;]|prometheus</code>
              </p>

              <Button variant="primary" size="sm" onClick={handleMultiStepRun} disabled={multiStepTesting}>
                {multiStepTesting ? 'Running...' : 'Run MultiStep'}
              </Button>

              {multiStepProgress && (
                <div className={styles.progressIndicator}>
                  <Icon name="sync" className="fa-spin" />
                  Step {multiStepProgress.current} of {multiStepProgress.total}
                </div>
              )}

              {multiStepResult && (
                <div
                  className={`${styles.resultBox} ${multiStepResult.success ? styles.resultSuccess : styles.resultError}`}
                >
                  <p className={styles.resultText}>
                    {multiStepResult.success && <Icon name="check" />} {multiStepResult.message}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Guided Debug - User Performs Actions */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setGuidedExpanded(!guidedExpanded)}>
          <h4 className={styles.sectionTitle}>Guided Debug (Manual Execution)</h4>
          <Icon name={guidedExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {guidedExpanded && (
          <div className={styles.sectionContent}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Steps (one per line: action|selector|value)</label>
              <TextArea
                className={styles.textArea}
                value={guidedInput}
                onChange={(e) => setGuidedInput(e.currentTarget.value)}
                placeholder="highlight|button[data-testid='save']|&#10;formfill|input[name='query']|prometheus&#10;button|Save Dashboard|"
                disabled={guidedRunning}
              />
              <p className={styles.helpText}>
                Highlights elements one at a time. You manually perform each action, then it moves to the next step.
              </p>

              <div className={styles.buttonGroup}>
                {!guidedRunning ? (
                  <Button variant="primary" size="sm" onClick={handleGuidedStart}>
                    <Icon name="play" />
                    Start Guided
                  </Button>
                ) : (
                  <Button variant="destructive" size="sm" onClick={handleGuidedCancel}>
                    <Icon name="times" />
                    Cancel
                  </Button>
                )}
              </div>

              {guidedRunning && (
                <div className={styles.guidedProgress}>
                  <Icon name="user" />
                  Waiting for you to perform step {guidedCurrentStep + 1} of {guidedSteps.length}
                  <div className={styles.guidedStepHint}>
                    {guidedSteps[guidedCurrentStep] && (
                      <code className={styles.exampleCode}>
                        {guidedSteps[guidedCurrentStep].action}|{guidedSteps[guidedCurrentStep].selector}|
                        {guidedSteps[guidedCurrentStep].value || ''}
                      </code>
                    )}
                  </div>
                </div>
              )}

              {guidedResult && (
                <div
                  className={`${styles.resultBox} ${guidedResult.success ? styles.resultSuccess : styles.resultError}`}
                >
                  <p className={styles.resultText}>
                    {guidedResult.success && <Icon name="check" />} {guidedResult.message}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Watch Mode - Click to Capture Selectors */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setWatchExpanded(!watchExpanded)}>
          <h4 className={styles.sectionTitle}>Watch Mode - Capture Selectors</h4>
          <Icon name={watchExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {watchExpanded && (
          <div className={styles.sectionContent}>
            <div className={styles.formGroup}>
              <Button
                variant={watchMode ? 'destructive' : 'primary'}
                size="md"
                onClick={handleWatchModeToggle}
                className={watchMode ? styles.watchModeActive : ''}
              >
                {watchMode && <span className={styles.recordingDot} />}
                <Icon name={watchMode ? 'eye' : 'eye-slash'} />
                {watchMode ? 'Watch Mode: ON' : 'Watch Mode: OFF'}
              </Button>

              {watchMode && (
                <div className={styles.watchModeHint}>
                  <Icon name="info-circle" size="sm" />
                  Click any element in Grafana to capture its selector
                </div>
              )}

              {capturedSelector && (
                <>
                  <label className={styles.label}>Captured Selector</label>
                  <Input className={styles.selectorInput} value={capturedSelector} readOnly />

                  {selectorInfo && (
                    <div className={styles.selectorMeta}>
                      <Badge text={selectorInfo.method} color="blue" />
                      <Badge
                        text={selectorInfo.isUnique ? 'Unique' : `${selectorInfo.matchCount} matches`}
                        color={selectorInfo.isUnique ? 'green' : 'orange'}
                      />
                      {selectorInfo.contextStrategy && <Badge text={selectorInfo.contextStrategy} color="purple" />}
                    </div>
                  )}

                  <div className={styles.buttonGroup}>
                    <Button
                      variant={selectorCopied ? 'success' : 'secondary'}
                      size="sm"
                      onClick={handleCopySelector}
                      className={selectorCopied ? styles.copiedButton : ''}
                    >
                      <Icon name={selectorCopied ? 'check' : 'copy'} />
                      {selectorCopied ? 'Copied!' : 'Copy'}
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleUseInSimpleTester}>
                      <Icon name="arrow-up" />
                      Use in Simple Tester
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Record Mode - Capture Multi-Step Sequences */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setRecordExpanded(!recordExpanded)}>
          <h4 className={styles.sectionTitle}>Record Mode - Capture Sequences</h4>
          <Icon name={recordExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {recordExpanded && (
          <div className={styles.sectionContent}>
            <div className={styles.formGroup}>
              <div className={styles.recordModeControls}>
                <Button
                  variant={recordMode ? 'destructive' : 'primary'}
                  size="md"
                  onClick={handleRecordModeToggle}
                  className={recordMode ? styles.recordModeActive : ''}
                >
                  {recordMode && <span className={styles.recordingDot} />}
                  <Icon name={recordMode ? 'pause' : 'circle'} />
                  {recordMode ? 'Stop Recording' : 'Start Recording'}
                </Button>

                {recordedSteps.length > 0 && <Badge text={`${recordedSteps.length} steps`} color="blue" />}
              </div>

              {recordMode && (
                <div className={styles.recordModeHint}>
                  <Icon name="info-circle" size="sm" />
                  Click elements and fill forms to record a sequence
                </div>
              )}

              {recordedSteps.length > 0 && (
                <>
                  <div className={styles.buttonGroup}>
                    <Button
                      variant={multistepMode ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={handleToggleMultistepMode}
                    >
                      <Icon name="link" />
                      {multistepMode ? 'Cancel Selection' : 'Combine Steps'}
                    </Button>

                    {multistepMode && selectedSteps.size > 1 && (
                      <Button variant="primary" size="sm" onClick={handleCombineSteps}>
                        <Icon name="save" />
                        Create Multistep ({selectedSteps.size})
                      </Button>
                    )}

                    <Button
                      variant={exportCopied ? 'success' : 'secondary'}
                      size="sm"
                      onClick={handleExportHTML}
                      className={exportCopied ? styles.copiedButton : ''}
                    >
                      <Icon name={exportCopied ? 'check' : 'file-alt'} />
                      {exportCopied ? 'Copied!' : 'Export to HTML'}
                    </Button>
                  </div>

                  <label className={styles.label}>Recorded Steps</label>
                  <div className={styles.recordedStepsList}>
                    {recordedSteps.map((step, index) => (
                      <div key={index} className={styles.recordedStep}>
                        {multistepMode && (
                          <input
                            type="checkbox"
                            checked={selectedSteps.has(index)}
                            onChange={() => handleToggleStepSelection(index)}
                            style={{ marginRight: '8px' }}
                          />
                        )}
                        <div className={styles.stepNumber}>{index + 1}</div>
                        <div className={styles.stepDetails}>
                          <div className={styles.stepDescription}>
                            {step.description}
                            {step.isUnique === false && (
                              <Icon
                                name="exclamation-triangle"
                                size="sm"
                                className={styles.warningIcon}
                                title={`Non-unique selector (${step.matchCount} matches)`}
                              />
                            )}
                          </div>
                          <code className={styles.stepCode}>
                            {step.action}|{step.selector}|{step.value || ''}
                          </code>
                          {(step.contextStrategy || step.isUnique === false) && (
                            <div className={styles.stepMeta}>
                              {step.contextStrategy && <Badge text={step.contextStrategy} color="purple" />}
                              {step.isUnique === false && <Badge text={`${step.matchCount} matches`} color="orange" />}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => handleDeleteStep(index)}
                          icon="trash-alt"
                          aria-label="Delete step"
                        />
                      </div>
                    ))}
                  </div>

                  <div className={styles.buttonGroup}>
                    <Button variant="secondary" size="sm" onClick={handleClearRecording}>
                      <Icon name="trash-alt" />
                      Clear All
                    </Button>
                    <Button
                      variant={allStepsCopied ? 'success' : 'secondary'}
                      size="sm"
                      onClick={handleCopyAllSteps}
                      className={allStepsCopied ? styles.copiedButton : ''}
                    >
                      <Icon name={allStepsCopied ? 'check' : 'copy'} />
                      {allStepsCopied ? 'Copied!' : 'Copy All'}
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleLoadIntoMultiStep}>
                      <Icon name="arrow-up" />
                      Load into MultiStep
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* GitHub Tutorial Tester */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setGithubExpanded(!githubExpanded)}>
          <h4 className={styles.sectionTitle}>GitHub Tutorial Tester</h4>
          <Icon name={githubExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {githubExpanded && (
          <div className={styles.sectionContent}>
            <div className={styles.formGroup}>
              <label className={styles.label}>GitHub Tree URL</label>
              <Input
                className={styles.selectorInput}
                value={githubUrl}
                onChange={(e) => {
                  setGithubUrl(e.currentTarget.value);
                  setGithubError(null);
                  setGithubSuccess(false);
                }}
                placeholder="https://github.com/grafana/interactive-tutorials/tree/main/explore-drilldowns-101"
              />
              <p className={styles.helpText}>
                Provide a GitHub tree URL pointing to a tutorial directory.
                <br />
                The URL should be in format: github.com/{'{owner}'}/{'{repo}'}/tree/{'{branch}'}/{'{path}'}
              </p>

              <Button
                variant="primary"
                size="sm"
                onClick={handleTestGithubTutorial}
                disabled={!githubUrl.trim() || !onOpenDocsPage}
              >
                <Icon name="external-link-alt" />
                Test Tutorial in New Tab
              </Button>

              {githubError && (
                <div className={`${styles.resultBox} ${styles.resultError}`}>
                  <p className={styles.resultText}>
                    <Icon name="exclamation-triangle" /> {githubError}
                  </p>
                </div>
              )}

              {githubSuccess && (
                <div className={`${styles.resultBox} ${styles.resultSuccess}`}>
                  <p className={styles.resultText}>
                    <Icon name="check" /> Tutorial opened in new tab!
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
