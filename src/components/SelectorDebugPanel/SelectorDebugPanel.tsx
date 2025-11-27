import React, { useState, useCallback, useEffect } from 'react';
import { Button, Input, Badge, Icon, useStyles2, TextArea, Stack, Alert, Field } from '@grafana/ui';
import { useInteractiveElements } from '../../interactive-engine';
import { getDebugPanelStyles } from './debug-panel.styles';
import { combineStepsIntoMultistep } from '../wysiwyg-editor/devtools/tutorial-exporter';
import { URLTester } from 'components/URLTester';
import { WysiwygEditor } from '../wysiwyg-editor';
import { useSelectorTester } from '../wysiwyg-editor/devtools/selector-tester.hook';
import { useStepExecutor } from '../wysiwyg-editor/devtools/step-executor.hook';
import { useSelectorCapture } from '../wysiwyg-editor/devtools/selector-capture.hook';
import { useActionRecorder } from '../wysiwyg-editor/devtools/action-recorder.hook';
import { parseStepString } from '../wysiwyg-editor/devtools/step-parser.util';
import { DomPathTooltip } from '../DomPathTooltip';

export interface SelectorDebugPanelProps {
  onOpenDocsPage?: (url: string, title: string) => void;
}

export function SelectorDebugPanel({ onOpenDocsPage }: SelectorDebugPanelProps = {}) {
  const styles = useStyles2(getDebugPanelStyles);
  const { executeInteractiveAction } = useInteractiveElements();

  // Section expansion state - priority sections expanded by default
  const [recordExpanded, setRecordExpanded] = useState(true); // Priority: expanded by default
  const [githubExpanded, setGithubExpanded] = useState(true); // Priority: expanded by default
  const [watchExpanded, setWatchExpanded] = useState(false);
  const [simpleExpanded, setSimpleExpanded] = useState(false);
  const [guidedExpanded, setGuidedExpanded] = useState(false);
  const [multiStepExpanded, setMultiStepExpanded] = useState(false);

  // Handle leaving dev mode
  const handleLeaveDevMode = useCallback(async () => {
    try {
      // Get current user ID and user list from global config
      const globalConfig = (window as any).__pathfinderPluginConfig;
      const currentUserId = (window as any).grafanaBootData?.user?.id;
      const currentUserIds = globalConfig?.devModeUserIds ?? [];

      // Import dynamically to avoid circular dependency
      const { disableDevModeForUser } = await import('../wysiwyg-editor/dev-mode');

      if (currentUserId) {
        await disableDevModeForUser(currentUserId, currentUserIds);
      } else {
        // Fallback: disable for all if can't determine user
        const { disableDevMode } = await import('../wysiwyg-editor/dev-mode');
        await disableDevMode();
      }

      window.location.reload();
    } catch (error) {
      console.error('Failed to disable dev mode:', error);

      // Show user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Failed to disable dev mode. Please try again.';
      alert(errorMessage);
    }
  }, []);

  // Simple Selector Tester
  const [simpleSelector, setSimpleSelector] = useState('');
  const {
    testSelector,
    isTesting: simpleTesting,
    result: simpleResult,
    wasStepFormatExtracted,
    extractedSelector,
  } = useSelectorTester({
    executeInteractiveAction,
  });

  // MultiStep Debug (auto-execution)
  const [multiStepInput, setMultiStepInput] = useState('');
  const {
    execute: executeMultiStep,
    isExecuting: multiStepTesting,
    progress: multiStepProgress,
    result: multiStepResult,
  } = useStepExecutor({ executeInteractiveAction });

  // Guided Debug (user performs actions manually)
  const [guidedInput, setGuidedInput] = useState('');
  const [guidedCurrentStep, setGuidedCurrentStep] = useState(0);
  const [guidedSteps, setGuidedSteps] = useState<Array<{ action: string; selector: string; value?: string }>>([]);
  const {
    execute: executeGuided,
    isExecuting: guidedRunning,
    progress: guidedProgress,
    result: guidedResult,
    cancel: cancelGuided,
  } = useStepExecutor({ executeInteractiveAction });

  // Guided Debug Handlers
  const handleGuidedStart = useCallback(async () => {
    const steps = parseStepString(guidedInput);
    setGuidedSteps(steps);
    setGuidedCurrentStep(0);

    // Execute with guided mode (error handling is done by the hook)
    await executeGuided(steps, 'guided');
  }, [guidedInput, executeGuided]);

  const handleGuidedCancel = useCallback(() => {
    cancelGuided();
    setGuidedCurrentStep(0);
  }, [cancelGuided]);

  // Update current step based on progress
  useEffect(() => {
    if (guidedRunning && guidedProgress) {
      setGuidedCurrentStep(guidedProgress.current - 1);
    } else if (!guidedRunning) {
      // Reset when execution stops (completed, cancelled, or error)
      setGuidedCurrentStep(0);
    }
  }, [guidedProgress, guidedRunning]);

  // Watch Mode
  const [selectorCopied, setSelectorCopied] = useState(false);
  const {
    isActive: watchMode,
    capturedSelector,
    selectorInfo,
    startCapture,
    stopCapture,
    domPath: watchDomPath,
    cursorPosition: watchCursorPosition,
  } = useSelectorCapture({
    autoDisable: true,
  });

  // Record Mode
  const [allStepsCopied, setAllStepsCopied] = useState(false);
  const {
    recordingState,
    isPaused,
    recordedSteps,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    clearRecording,
    deleteStep,
    setRecordedSteps,
    exportSteps: exportStepsFromRecorder,
    domPath: recordDomPath,
    cursorPosition: recordCursorPosition,
  } = useActionRecorder();

  // Export State
  const [exportCopied, setExportCopied] = useState(false);

  // Multistep Selection State
  const [selectedSteps, setSelectedSteps] = useState<Set<number>>(new Set());
  const [multistepMode, setMultistepMode] = useState(false);

  // Simple Selector Tester Handlers
  const handleSimpleShow = useCallback(async () => {
    await testSelector(simpleSelector, 'show');
  }, [simpleSelector, testSelector]);

  const handleSimpleDo = useCallback(async () => {
    await testSelector(simpleSelector, 'do');
  }, [simpleSelector, testSelector]);

  // MultiStep Debug Handlers
  const handleMultiStepRun = useCallback(async () => {
    const steps = parseStepString(multiStepInput);
    await executeMultiStep(steps, 'auto');
  }, [multiStepInput, executeMultiStep]);

  // Watch Mode Handlers
  const handleWatchModeToggle = useCallback(() => {
    if (watchMode) {
      stopCapture();
    } else {
      startCapture();
    }
  }, [watchMode, startCapture, stopCapture]);

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
    if (capturedSelector) {
      setSimpleSelector(capturedSelector);
      setSimpleExpanded(true);
      // Always turn off watch mode after using selector
      stopCapture();
    }
  }, [capturedSelector, stopCapture]);

  // Record Mode Handlers
  const handleStartRecording = useCallback(() => {
    if (isPaused) {
      resumeRecording();
    } else {
      startRecording();
    }
  }, [isPaused, startRecording, resumeRecording]);

  const handlePauseRecording = useCallback(() => {
    pauseRecording();
  }, [pauseRecording]);

  const handleStopRecording = useCallback(() => {
    stopRecording();
  }, [stopRecording]);

  const handleClearRecording = useCallback(() => {
    clearRecording();
  }, [clearRecording]);

  const handleDeleteStep = useCallback(
    (index: number) => {
      deleteStep(index);
    },
    [deleteStep]
  );

  const handleCopyAllSteps = useCallback(async () => {
    const stepsText = exportStepsFromRecorder('string');
    try {
      await navigator.clipboard.writeText(stepsText);
      setAllStepsCopied(true);
      // Reset after 2 seconds
      setTimeout(() => setAllStepsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy steps:', error);
    }
  }, [exportStepsFromRecorder]);

  const handleLoadIntoMultiStep = useCallback(() => {
    const stepsText = exportStepsFromRecorder('string');
    setMultiStepInput(stepsText);
    setMultiStepExpanded(true);
  }, [exportStepsFromRecorder]);

  const handleExportHTML = useCallback(async () => {
    const html = exportStepsFromRecorder('html', {
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
  }, [exportStepsFromRecorder]);

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
  }, [selectedSteps, recordedSteps, setRecordedSteps]);

  const handleToggleMultistepMode = useCallback(() => {
    if (multistepMode) {
      // Turning off - clear selections
      setSelectedSteps(new Set());
    }
    setMultistepMode(!multistepMode);
  }, [multistepMode]);

  return (
    <div className={styles.container} data-devtools-panel="true">
      <div className={styles.header}>
        <Stack direction="row" gap={1} alignItems="center">
          <Icon name="bug" size="lg" />
          <Badge text="Dev Mode" color="orange" className={styles.badge} />
        </Stack>
        <Button variant="secondary" size="sm" onClick={handleLeaveDevMode} icon="times" fill="outline">
          Leave Dev Mode
        </Button>
      </div>

      <WysiwygEditor />

      {/* PRIORITY SECTION 1: Record Mode - Capture Multi-Step Sequences */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setRecordExpanded(!recordExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="circle" />
            <h4 className={styles.sectionTitle}>Record Mode - Capture Sequences</h4>
            {recordedSteps.length > 0 && <Badge text={`${recordedSteps.length} steps`} color="blue" />}
          </Stack>
          <Icon name={recordExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {recordExpanded && (
          <div className={styles.sectionContent}>
            <Stack direction="column" gap={2}>
              <Stack direction="row" gap={1} wrap="wrap" alignItems="center">
                <Button
                  variant={recordingState === 'idle' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={handleStartRecording}
                  disabled={recordingState === 'recording'}
                  className={recordingState === 'recording' ? styles.recordModeActive : ''}
                >
                  {recordingState === 'recording' && <span className={styles.recordingDot} />}
                  <Icon name={isPaused ? 'play' : 'circle'} />
                  {isPaused ? 'Resume Recording' : 'Start Recording'}
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePauseRecording}
                  disabled={recordingState !== 'recording'}
                  className={isPaused ? styles.pausedModeActive : ''}
                >
                  {isPaused && <span className={styles.pausedDot} />}
                  <Icon name="pause" />
                  Pause
                </Button>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleStopRecording}
                  disabled={recordingState === 'idle'}
                >
                  <Icon name="times" />
                  Stop
                </Button>
              </Stack>

              {recordingState === 'recording' && (
                <div className={styles.recordModeHint}>
                  <Icon name="info-circle" size="sm" />
                  Click elements to record a sequence
                </div>
              )}

              {isPaused && (
                <div className={styles.recordModeHint} style={{ color: 'var(--grafana-colors-warning-text)' }}>
                  <Icon name="pause" size="sm" />
                  Paused. Click &quot;Resume Recording&quot; to continue capturing actions.
                </div>
              )}

              {recordedSteps.length > 0 && (
                <>
                  <Stack direction="row" gap={1} wrap="wrap">
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
                  </Stack>

                  <Field label="Recorded Steps">
                    <div className={styles.recordedStepsList}>
                      {recordedSteps.map((step, index) => (
                        <div key={`${step.selector}-${step.action}-${index}`} className={styles.recordedStep}>
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
                                {step.isUnique === false && (
                                  <Badge text={`${step.matchCount} matches`} color="orange" />
                                )}
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
                  </Field>

                  <Stack direction="row" gap={1} wrap="wrap">
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
                      <Icon name="arrow-down" />
                      Load into MultiStep
                    </Button>
                  </Stack>
                </>
              )}
            </Stack>
          </div>
        )}
      </div>

      {/* PRIORITY SECTION 2: Tutorial Tester */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setGithubExpanded(!githubExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="external-link-alt" />
            <h4 className={styles.sectionTitle}>Tutorial Tester</h4>
          </Stack>
          <Icon name={githubExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {githubExpanded && onOpenDocsPage && (
          <div className={styles.sectionContent}>
            <URLTester onOpenDocsPage={onOpenDocsPage} />
          </div>
        )}
      </div>

      {/* Watch Mode - Click to Capture Selectors */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setWatchExpanded(!watchExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="eye" />
            <h4 className={styles.sectionTitle}>Watch Mode - Capture Selectors</h4>
          </Stack>
          <Icon name={watchExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {watchExpanded && (
          <div className={styles.sectionContent}>
            <Stack direction="column" gap={2}>
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
                  <Field label="Captured Selector">
                    <Input className={styles.selectorInput} value={capturedSelector} readOnly />
                  </Field>

                  {selectorInfo && (
                    <Stack direction="row" gap={1}>
                      <Badge text={selectorInfo.method} color="blue" />
                      <Badge
                        text={selectorInfo.isUnique ? 'Unique' : `${selectorInfo.matchCount} matches`}
                        color={selectorInfo.isUnique ? 'green' : 'orange'}
                      />
                      {selectorInfo.contextStrategy && <Badge text={selectorInfo.contextStrategy} color="purple" />}
                    </Stack>
                  )}

                  <Stack direction="row" gap={1}>
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
                      <Icon name="arrow-down" />
                      Use in Simple Tester
                    </Button>
                  </Stack>
                </>
              )}
            </Stack>
          </div>
        )}
      </div>

      {/* Simple Selector Tester */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setSimpleExpanded(!simpleExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="crosshair" />
            <h4 className={styles.sectionTitle}>Simple Selector Tester</h4>
          </Stack>
          <Icon name={simpleExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {simpleExpanded && (
          <div className={styles.sectionContent}>
            <Stack direction="column" gap={2}>
              <Field label="CSS Selector" description="Supports :contains, :has, :nth-match">
                <Input
                  className={styles.selectorInput}
                  value={simpleSelector}
                  onChange={(e) => setSimpleSelector(e.currentTarget.value)}
                  placeholder='button[data-testid="save-button"]'
                  disabled={simpleTesting}
                />
              </Field>

              {wasStepFormatExtracted && extractedSelector && (
                <Alert title="" severity="info">
                  <Stack direction="column" gap={1}>
                    <Stack direction="row" gap={1} alignItems="center">
                      <Icon name="info-circle" size="sm" />
                      <span>
                        Oops! You pasted a selector in step format. We&apos;ve automatically extracted the selector for
                        you, but note that other tools might expect plain CSS selectors.
                      </span>
                    </Stack>
                    <code className={styles.exampleCode}>
                      <strong>Extracted selector:</strong> {extractedSelector}
                    </code>
                  </Stack>
                </Alert>
              )}

              <Stack direction="row" gap={1}>
                <Button variant="secondary" size="sm" onClick={handleSimpleShow} disabled={simpleTesting}>
                  {simpleTesting ? 'Testing...' : 'Show me'}
                </Button>
                <Button variant="primary" size="sm" onClick={handleSimpleDo} disabled={simpleTesting}>
                  {simpleTesting ? 'Testing...' : 'Do it'}
                </Button>
              </Stack>

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
            </Stack>
          </div>
        )}
      </div>

      {/* Guided Debug - User Performs Actions */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setGuidedExpanded(!guidedExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="user" />
            <h4 className={styles.sectionTitle}>Guided Debug (Manual Execution)</h4>
          </Stack>
          <Icon name={guidedExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {guidedExpanded && (
          <div className={styles.sectionContent}>
            <Stack direction="column" gap={2}>
              <Field
                label="Steps"
                description="Highlights elements one at a time. You manually perform each action, then it moves to the next step."
              >
                <TextArea
                  className={styles.textArea}
                  value={guidedInput}
                  onChange={(e) => setGuidedInput(e.currentTarget.value)}
                  placeholder="highlight|button[data-testid='save']|&#10;formfill|input[name='query']|prometheus&#10;button|Save Dashboard|"
                  disabled={guidedRunning}
                />
              </Field>

              <p className={styles.helpText}>
                Format: <code className={styles.exampleCode}>action|selector|value</code>
              </p>

              <Stack direction="row" gap={1}>
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
              </Stack>

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
            </Stack>
          </div>
        )}
      </div>

      {/* MultiStep Debug (Auto-Execute) */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setMultiStepExpanded(!multiStepExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="bolt" />
            <h4 className={styles.sectionTitle}>MultiStep Debug (Auto-Execute)</h4>
          </Stack>
          <Icon name={multiStepExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {multiStepExpanded && (
          <div className={styles.sectionContent}>
            <Stack direction="column" gap={2}>
              <Field label="Steps" description="One per line: action|selector|value">
                <TextArea
                  className={styles.textArea}
                  value={multiStepInput}
                  onChange={(e) => setMultiStepInput(e.currentTarget.value)}
                  placeholder="highlight|button[data-testid='save']|&#10;formfill|input[name='query']|prometheus&#10;button|Save Dashboard|"
                  disabled={multiStepTesting}
                />
              </Field>

              <p className={styles.helpText}>
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
            </Stack>
          </div>
        )}
      </div>

      {/* DOM Path Tooltip for Watch Mode */}
      {watchMode && watchDomPath && watchCursorPosition && (
        <DomPathTooltip domPath={watchDomPath} position={watchCursorPosition} visible={true} />
      )}

      {/* DOM Path Tooltip for Record Mode */}
      {recordingState !== 'idle' && recordDomPath && recordCursorPosition && (
        <DomPathTooltip domPath={recordDomPath} position={recordCursorPosition} visible={true} />
      )}
    </div>
  );
}
