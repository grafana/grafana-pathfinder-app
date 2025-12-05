/**
 * Shared types for dev tools utilities and hooks
 */

export interface StepDefinition {
  action: string;
  selector: string;
  value?: string;
}

export interface SelectorInfo {
  method: string;
  isUnique: boolean;
  matchCount: number;
  contextStrategy?: string;
}

export interface TestResult {
  success: boolean;
  message: string;
  matchCount?: number;
}

export interface ProgressInfo {
  current: number;
  total: number;
}

export interface ExtractedSelector {
  selector: string;
  action: string;
  value?: string;
  description: string;
  isUnique?: boolean;
  matchCount?: number;
  contextStrategy?: string;
}
