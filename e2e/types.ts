/**
 * Type definitions for the e2e testing framework
 */

export interface GuideMetadata {
  id: string;
  url: string;
  title: string;
}

export interface StepInfo {
  index: number;
  type: InteractiveActionType;
  reftarget: string;
  targetvalue?: string;
  requirements?: string;
  objectives?: string;
  skippable: boolean;
  stepHtml: string;
  textContent?: string;
}

export type InteractiveActionType =
  | 'highlight'
  | 'button'
  | 'formfill'
  | 'navigate'
  | 'hover'
  | 'sequence'
  | 'multistep'
  | 'guided';

export type StepStatus = 'passed' | 'failed' | 'skipped';

export interface StepError {
  type:
    | 'selector_not_found'
    | 'element_not_clickable'
    | 'requirement_failed'
    | 'timeout'
    | 'button_not_found'
    | 'action_failed'
    | 'unknown';
  message: string;
  stepHtml: string;
  screenshot?: string;
  consoleErrors?: string[];
  domState?: string;
  domSnapshot?: string;
  availableSelectors?: string[];
  pageState?: string;
}

export interface StepResult {
  index: number;
  type: InteractiveActionType;
  reftarget: string;
  status: StepStatus;
  error?: StepError;
  showMeDuration: number;
  doItDuration: number;
  totalDuration: number;
}

export interface TestReport {
  guide: GuideMetadata;
  summary: {
    totalSteps: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  steps: StepResult[];
  timestamp: string;
  grafanaUrl: string;
  duration: number;
}

export interface TestConfig {
  guideUrl: string;
  grafanaUrl: string;
  outputDir: string;
  startStack: boolean;
  timeout: number;
}

