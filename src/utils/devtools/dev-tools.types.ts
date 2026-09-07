/**
 * Shared types for dev tools utilities and hooks
 */

export interface RecordedStep {
  action: string;
  selector: string;
  value?: string;
  description: string;
  isUnique?: boolean;
  matchCount?: number;
  contextStrategy?: string;
  /** If set, this step is part of a group (e.g., modal interaction) */
  groupId?: string;
}

export interface SelectorInfo {
  method: string;
  isUnique: boolean;
  matchCount: number;
  contextStrategy?: string;
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
