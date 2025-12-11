import React, { useState, useCallback, useEffect, lazy, Suspense, useRef } from 'react';
import { Button, Input, Badge, Icon, useStyles2, TextArea, Stack, Alert, Field } from '@grafana/ui';
import { useInteractiveElements } from '../../interactive-engine';
import { getDebugPanelStyles } from './debug-panel.styles';
import {
  combineStepsIntoMultistep,
  combineStepsIntoGuided,
  useSelectorTester,
  useStepExecutor,
  useSelectorCapture,
  useActionRecorder,
  parseStepString,
  type RecordedStep,
} from '../../utils/devtools';
import { UrlTester } from 'components/UrlTester';
import { DomPathTooltip } from '../DomPathTooltip';
import { useWebsiteExport } from '../../utils/use-website-export.hook';
import { SkeletonLoader } from '../SkeletonLoader';
import { StorageKeys } from '../../lib/user-storage';

// Lazy load BlockEditor to keep it out of main bundle when not needed
const BlockEditor = lazy(() =>
  import('../block-editor').then((module) => ({
    default: module.BlockEditor,
  }))
);

export interface SelectorDebugPanelProps {
  onOpenDocsPage?: (url: string, title: string) => void;
}

export function SelectorDebugPanel({ onOpenDocsPage }: SelectorDebugPanelProps = {}) {
  const styles = useStyles2(getDebugPanelStyles);
  const { executeInteractiveAction } = useInteractiveElements();

  // Section expansion state - priority sections expanded by default
  const [blockEditorExpanded, setBlockEditorExpanded] = useState(false);
  const [recordExpanded, setRecordExpanded] = useState(true); // Priority: expanded by default
  const [UrlTesterExpanded, setUrlTesterExpanded] = useState(true); // Priority: expanded by default
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
  const [recordingStartUrl, setRecordingStartUrl] = useState<string | null>(null);
  const hasRestoredFromStorage = useRef(false);
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

  // Restore recording state from sessionStorage on mount
  useEffect(() => {
    if (hasRestoredFromStorage.current) {
      return;
    }
    hasRestoredFromStorage.current = true;

    try {
      const savedState = sessionStorage.getItem(StorageKeys.DEVTOOLS_RECORDING_STATE);
      if (savedState) {
        const parsed = JSON.parse(savedState) as {
          recordedSteps: RecordedStep[];
          recordingStartUrl: string | null;
        };
        if (parsed.recordedSteps && parsed.recordedSteps.length > 0) {
          setRecordedSteps(parsed.recordedSteps);
        }
        if (parsed.recordingStartUrl) {
          setRecordingStartUrl(parsed.recordingStartUrl);
        }
      }
    } catch (error) {
      console.warn('Failed to restore recording state from storage:', error);
    }
  }, [setRecordedSteps]);

  // Persist recording state to sessionStorage when it changes
  useEffect(() => {
    if (!hasRestoredFromStorage.current) {
      return; // Don't persist until we've attempted to restore
    }

    try {
      const stateToSave = {
        recordedSteps,
        recordingStartUrl,
      };
      sessionStorage.setItem(StorageKeys.DEVTOOLS_RECORDING_STATE, JSON.stringify(stateToSave));
    } catch (error) {
      console.warn('Failed to persist recording state to storage:', error);
    }
  }, [recordedSteps, recordingStartUrl]);

  // Export State
  const [exportCopied, setExportCopied] = useState(false);

  // Website Export
  const { copyForWebsite, copySingleForWebsite, copied: websiteCopied } = useWebsiteExport();

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

  const handleCopySimpleForWebsite = useCallback(async () => {
    await copySingleForWebsite('highlight', simpleSelector, undefined, 'Perform action on element');
  }, [simpleSelector, copySingleForWebsite]);

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
      setRecordingStartUrl(window.location.href);
    }
  }, [isPaused, startRecording, resumeRecording]);

  const handleReturnToStart = useCallback(() => {
    if (recordingStartUrl) {
      window.location.href = recordingStartUrl;
    }
  }, [recordingStartUrl]);

  const handlePauseRecording = useCallback(() => {
    pauseRecording();
  }, [pauseRecording]);

  const handleStopRecording = useCallback(() => {
    stopRecording();
    // Keep recordingStartUrl so user can return to start after stopping
  }, [stopRecording]);

  const handleClearRecording = useCallback(() => {
    clearRecording();
    setRecordingStartUrl(null);
    // Clear persisted state
    try {
      sessionStorage.removeItem(StorageKeys.DEVTOOLS_RECORDING_STATE);
    } catch {
      // Ignore storage errors
    }
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
      sectionId: 'Url-section',
      sectionTitle: 'Url section',
    });

    try {
      await navigator.clipboard.writeText(html);
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy HTML:', error);
    }
  }, [exportStepsFromRecorder]);

  const handleExportForWebsite = useCallback(async () => {
    await copyForWebsite(recordedSteps, {
      includeComments: true,
      includeHints: false,
      wrapInSequence: false,
      sequenceId: 'tutorial-section',
    });
  }, [recordedSteps, copyForWebsite]);

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

    // Build description from selected steps' descriptions
    const sortedIndices = Array.from(selectedSteps).sort((a, b) => a - b);
    const descriptions = sortedIndices.map((i) => recordedSteps[i]?.description).filter((d): d is string => Boolean(d));
    const description = descriptions.join('. ').replace(/\.\./g, '.') || 'Combined steps';

    const newSteps = combineStepsIntoMultistep(recordedSteps, sortedIndices, description);

    setRecordedSteps(newSteps);
    setSelectedSteps(new Set());
    setMultistepMode(false);
  }, [selectedSteps, recordedSteps, setRecordedSteps]);

  const handleCombineAsGuided = useCallback(() => {
    if (selectedSteps.size < 2) {
      return;
    }

    // Build description from selected steps' descriptions
    const sortedIndices = Array.from(selectedSteps).sort((a, b) => a - b);
    const descriptions = sortedIndices.map((i) => recordedSteps[i]?.description).filter((d): d is string => Boolean(d));
    const description = descriptions.join('. ').replace(/\.\./g, '.') || 'Guided steps';

    const newSteps = combineStepsIntoGuided(recordedSteps, sortedIndices, description);

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
          Leave dev mode
        </Button>
      </div>

      {/* Block Editor */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setBlockEditorExpanded(!blockEditorExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="edit" />
            <h4 className={styles.sectionTitle}>New guide</h4>
          </Stack>
          <Icon name={blockEditorExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {blockEditorExpanded && (
          <div className={styles.sectionContent}>
            <Suspense fallback={<SkeletonLoader type="recommendations" />}>
              <BlockEditor />
            </Suspense>
          </div>
        )}
      </div>

      {/* PRIORITY SECTION 1: Record Mode - Capture Multi-Step Sequences */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setRecordExpanded(!recordExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="circle" />
            <h4 className={styles.sectionTitle}>Record mode - capture sequences</h4>
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
                  {isPaused ? 'Resume recording' : 'Start recording'}
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

                {recordingStartUrl && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleReturnToStart}
                    disabled={window.location.href === recordingStartUrl}
                    title={
                      window.location.href === recordingStartUrl
                        ? 'Already at starting page'
                        : 'Return to the page where recording started'
                    }
                  >
                    <Icon name="arrow-left" />
                    Return to start
                  </Button>
                )}
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
                  Paused. Click &quot;Resume recording&quot; to continue capturing actions.
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
                      {multistepMode ? 'Cancel selection' : 'Combine steps'}
                    </Button>

                    {multistepMode && selectedSteps.size > 1 && (
                      <>
                        <Button variant="primary" size="sm" onClick={handleCombineSteps}>
                          <Icon name="save" />
                          Multistep ({selectedSteps.size})
                        </Button>
                        <Button variant="secondary" size="sm" onClick={handleCombineAsGuided}>
                          <Icon name="user" />
                          Guided ({selectedSteps.size})
                        </Button>
                      </>
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
                    <Button
                      variant={websiteCopied ? 'success' : 'secondary'}
                      size="sm"
                      onClick={handleExportForWebsite}
                      className={websiteCopied ? styles.copiedButton : ''}
                    >
                      <Icon name={websiteCopied ? 'check' : 'file-alt'} />
                      {websiteCopied ? 'Copied!' : 'Export for website'}
                    </Button>
                  </Stack>

                  <Field label="Recorded steps">
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
                      Clear all
                    </Button>
                    <Button
                      variant={allStepsCopied ? 'success' : 'secondary'}
                      size="sm"
                      onClick={handleCopyAllSteps}
                      className={allStepsCopied ? styles.copiedButton : ''}
                    >
                      <Icon name={allStepsCopied ? 'check' : 'copy'} />
                      {allStepsCopied ? 'Copied!' : 'Copy all'}
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleLoadIntoMultiStep}>
                      <Icon name="arrow-down" />
                      Load into multistep
                    </Button>
                  </Stack>
                </>
              )}
            </Stack>
          </div>
        )}
      </div>

      {/* PRIORITY SECTION 2: Url tester */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setUrlTesterExpanded(!UrlTesterExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="external-link-alt" />
            <h4 className={styles.sectionTitle}>URL tester</h4>
          </Stack>
          <Icon name={UrlTesterExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {UrlTesterExpanded && onOpenDocsPage && (
          <div className={styles.sectionContent}>
            <UrlTester onOpenDocsPage={onOpenDocsPage} />
          </div>
        )}
      </div>

      {/* Watch Mode - Click to Capture Selectors */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => setWatchExpanded(!watchExpanded)}>
          <Stack direction="row" gap={1} alignItems="center">
            <Icon name="eye" />
            <h4 className={styles.sectionTitle}>Watch mode - capture selectors</h4>
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
                {watchMode ? 'Watch mode: ON' : 'Watch mode: OFF'}
              </Button>

              {watchMode && (
                <div className={styles.watchModeHint}>
                  <Icon name="info-circle" size="sm" />
                  Click any element in Grafana to capture its selector
                </div>
              )}

              {capturedSelector && (
                <>
                  <Field label="Captured selector">
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
                      Use in simple tester
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
            <h4 className={styles.sectionTitle}>Simple selector tester</h4>
          </Stack>
          <Icon name={simpleExpanded ? 'angle-up' : 'angle-down'} />
        </div>
        {simpleExpanded && (
          <div className={styles.sectionContent}>
            <Stack direction="column" gap={2}>
              <Field label="CSS selector" description="Supports :contains, :has, :nth-match">
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
                <Button
                  variant={websiteCopied ? 'success' : 'secondary'}
                  size="sm"
                  onClick={handleCopySimpleForWebsite}
                  disabled={!simpleSelector || simpleTesting}
                  className={websiteCopied ? styles.copiedButton : ''}
                >
                  <Icon name={websiteCopied ? 'check' : 'copy'} />
                  {websiteCopied ? 'Copied!' : 'Copy for Website'}
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
            <h4 className={styles.sectionTitle}>Guided debug (manual execution)</h4>
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
                    Start guided
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
            <h4 className={styles.sectionTitle}>Multistep debug (auto-execute)</h4>
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
                {multiStepTesting ? 'Running...' : 'Run multistep'}
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
