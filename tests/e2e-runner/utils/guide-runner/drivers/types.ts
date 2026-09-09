import type { Locator, Page } from '@playwright/test';

import type { StepTypeKind } from '../../../../../src/components/interactive-tutorial/step-type-registry';
import type { GuidedSubstepResult, TestableStep } from '../types';

export interface StepDriverInspection {
  skippable: boolean;
  hasDoItButton: boolean;
  hasShowMeButton: boolean;
  isPreCompleted: boolean;
  targetAction?: string;
  actionCount: number;
  guidedStepTimeoutMs?: number;
  refTarget?: string;
}

export interface StepDriverExecutionContext {
  page: Page;
  step: TestableStep;
  timeout: number;
  verbose: boolean;
  artifactsDir?: string;
  onGuidedSubstepSettled?: (result: GuidedSubstepResult) => void;
}

export interface StepDriverExecutionResult {
  outcome: 'completed' | 'no-control';
  completedViaObjectives?: boolean;
}

export interface StepDriver {
  kind: StepTypeKind;
  supported: boolean;
  inspect(page: Page, root: Locator, stepId: string): Promise<StepDriverInspection>;
  timeout(step: TestableStep): number;
  completionState(page: Page, stepId: string): Promise<boolean>;
  skip(page: Page, stepId: string, timeout?: number): Promise<void>;
  execute(context: StepDriverExecutionContext): Promise<StepDriverExecutionResult>;
}
