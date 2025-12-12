/**
 * Dev tools exports
 *
 * Common utilities for selector generation, action recording, and step execution
 * used by the block editor and SelectorDebugPanel.
 */

// Types
export type { StepDefinition, SelectorInfo, TestResult, ProgressInfo, ExtractedSelector } from './dev-tools.types';

// Tutorial exporter
export type { RecordedStep, MultistepGroup, ExportStep, ExportOptions } from './tutorial-exporter';
export {
  exportStepsToHTML,
  combineStepsIntoMultistep,
  combineStepsIntoGuided,
  detectMultistepGroups,
  exportAsFullHTML,
} from './tutorial-exporter';

// Step parser utilities
export { parseStepString, formatStepsToString, extractSelector } from './step-parser.util';

// Selector generator
export type { SelectorGenerationResult } from './selector-generator.util';
export { generateSelectorFromEvent } from './selector-generator.util';

// Element inspector hook
export type { UseElementInspectorOptions, UseElementInspectorReturn } from './element-inspector.hook';
export { generateFullDomPath, useElementInspector } from './element-inspector.hook';

// Selector capture hook (Watch Mode)
export type { UseSelectorCaptureOptions, UseSelectorCaptureReturn } from './selector-capture.hook';
export { useSelectorCapture } from './selector-capture.hook';

// Selector tester hook
export type { UseSelectorTesterOptions, UseSelectorTesterReturn } from './selector-tester.hook';
export { useSelectorTester } from './selector-tester.hook';

// Action recorder hook (Record Mode)
export type {
  RecordingState,
  ActionGroup,
  UseActionRecorderOptions,
  UseActionRecorderReturn,
} from './action-recorder.hook';
export { useActionRecorder } from './action-recorder.hook';

// Action recorder utilities
export { extractSelectors, extractSelectorStrings, filterStepsByAction } from './action-recorder.util';

// Step executor hook
export type { UseStepExecutorOptions, UseStepExecutorReturn } from './step-executor.hook';
export { useStepExecutor } from './step-executor.hook';

// Step executor utility
export type { ExecutionOptions, ExecutionResult } from './step-executor.util';
export { executeStepSequence } from './step-executor.util';

// Hover highlight utilities
export { createHoverHighlight, updateHoverHighlight, removeHoverHighlight } from './hover-highlight.util';

