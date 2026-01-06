/**
 * Dev tools exports
 *
 * Common utilities for selector generation and action recording
 * used by the block editor.
 */

// Types
export type { StepDefinition, SelectorInfo, ExtractedSelector } from './dev-tools.types';

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

// Hover highlight utilities
export { createHoverHighlight, updateHoverHighlight, removeHoverHighlight } from './hover-highlight.util';
