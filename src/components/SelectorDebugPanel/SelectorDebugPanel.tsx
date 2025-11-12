import React, { useState, useCallback, useEffect } from 'react';
import { Button, Input, Badge, Icon, useStyles2, TextArea } from '@grafana/ui';
import { useInteractiveElements } from '../../interactive-engine';
import { getDebugPanelStyles } from './debug-panel.styles';
import { combineStepsIntoMultistep } from '../../utils/devtools/tutorial-exporter';
import { URLTester } from 'components/URLTester';
import { useSelectorTester } from '../../utils/devtools/selector-tester.hook';
import { useStepExecutor } from '../../utils/devtools/step-executor.hook';
import { useSelectorCapture } from '../../utils/devtools/selector-capture.hook';
import { useActionRecorder } from '../../utils/devtools/action-recorder.hook';
import { parseStepString } from '../../utils/devtools/step-parser.util';

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
  const handleLeaveDevMode = useCallback(async () => {
    try {
      // Get current user ID and user list from global config
      const globalConfig = (window as any).__pathfinderPluginConfig;
      const currentUserId = (window as any).grafanaBootData?.user?.id;
      const currentUserIds = globalConfig?.devModeUserIds ?? [];

      // Import dynamically to avoid circular dependency
      const { disableDevModeForUser } = await import('../../utils/dev-mode');

      if (currentUserId) {
        await disableDevModeForUser(currentUserId, currentUserIds);
      } else {
        // Fallback: disable for all if can't determine user
        const { disableDevMode } = await import('../../utils/dev-mode');
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
  } = useSelectorCapture({
    autoDisable: true,
  });

  // Record Mode
  const [allStepsCopied, setAllStepsCopied] = useState(false);
  const {
    isRecording: recordMode,
    recordedSteps,
    startRecording,
    stopRecording,
    clearRecording,
    deleteStep,
    setRecordedSteps,
    exportSteps: exportStepsFromRecorder,
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
  const handleRecordModeToggle = useCallback(() => {
    if (recordMode) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [recordMode, startRecording, stopRecording]);

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
    <div className={styles.container}>
      <div className={styles.header}>
        <Icon name="bug" size="lg" />
        <h3 className={styles.title}>DOM Selector Debug</h3>
        <Badge text="Dev Mode" color="orange" className={styles.badge} />
      </div>

      {/* Leave Dev Mode button in its own row */}
      <div className={styles.leaveDevModeRow}>
        <Button variant="secondary" size="sm" onClick={handleLeaveDevMode} icon="times" fill="outline">
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
          <h4 className={styles.sectionTitle}>Tutorial Tester</h4>
          <Icon name={githubExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {githubExpanded && onOpenDocsPage && (
          <div className={styles.sectionContent}>
            <URLTester onOpenDocsPage={onOpenDocsPage} />
          </div>
        )}
      </div>
    </div>
  );
}
