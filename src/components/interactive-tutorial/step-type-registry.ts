/**
 * Step-type schema registry.
 *
 * Single source of truth for the per-step-type behaviour currently
 * encoded in two parallel `switch-on-component-type` chains inside
 * `interactive-section.tsx`:
 *   1. The `stepComponents` useMemo (builds `StepInfo` records).
 *   2. The `enhancedChildren` useMemo (clones each child with the
 *      type-specific enhanced props).
 *
 * Tier A3 (this file) introduces the registry as a *capability* —
 * neither switch chain consumes it yet. Tier A4 collapses both
 * switches into table-driven loops that look up the schema by
 * component identity. Per the High-Risk Refactor Guidelines
 * (Principle 6 — "Separate Adding Functionality from Moving Code"),
 * the capability lands first and is tested independently.
 *
 * The registry intentionally has no imports of the step component
 * modules. That keeps it a pure schema and lets the consumer
 * (`interactive-section.tsx`) build the component-identity ↔ schema
 * lookup at the call site, so the registry's unit tests need no
 * jest.mock of the heavy step modules.
 *
 * 4-site contract: this is the canonical step-type list for
 * `interactive-section.tsx`'s orchestration concerns. The cursor
 * rule `.cursor/rules/tracked-step-types.mdc` documents the three
 * other sites (`content-renderer.tsx` × 2, `section-child-classifier.ts`).
 */

import type { StepInfo } from '../../types/component-props.types';

/** Discriminant for the seven tracked step component types. */
export type StepTypeKind = 'plain' | 'multistep' | 'guided' | 'quiz' | 'terminal' | 'terminal-connect' | 'codeblock';

/** Where the cloneElement `ref` callback for this type should be
 *  stored on the section. `'none'` means no ref is attached. */
export type RefTargetMap = 'stepRefs' | 'multiStepRefs' | 'none';

/** Per-type StepInfo fields. Excludes `stepId`, `element`, `index`
 *  which the caller composes from outer context. */
export type StepInfoExtension = Omit<StepInfo, 'stepId' | 'element' | 'index'>;

/** Context required to build the cloneElement props for a step. */
export interface EnhanceContext {
  stepInfo: StepInfo;
  isEligibleForChecking: boolean;
  isCompleted: boolean;
  isCurrentlyExecuting: boolean;
  documentStepIndex: number;
  documentTotalSteps: number;
  sectionId: string;
  sectionTitle: string | undefined;
  /** Base `disabled` prop passed to the section. */
  baseDisabled: boolean;
  /** Whether the section is currently in the Do Section run. */
  isRunning: boolean;
  /** Whether the section's own `requirements` are currently passing. */
  sectionRequirementsPassed: boolean;
  /** Signal value the section bumps to force child step components to
   *  reset their local UI state. */
  resetTrigger: number;
  onStepComplete: (stepId: string, skipStateUpdate?: boolean) => void;
  onStepReset: (stepId: string) => void;
}

/** Schema for one tracked step component type. */
export interface StepTypeSchema {
  kind: StepTypeKind;
  /** Used to build per-type stepIds (`${sectionId}-${idPrefix}-${n}`). */
  idPrefix: 'step' | 'multistep' | 'guided' | 'quiz' | 'terminal' | 'terminal-connect' | 'codeblock';
  /** Where the section stores ref callbacks for this type. */
  refTarget: RefTargetMap;
  /** Build the StepInfo's type-specific fields from the child's props. */
  toStepInfoExtension(props: any): StepInfoExtension;
  /** Build the cloneElement props for this child type. Excludes `ref`
   *  and `key` — the caller adds those based on `refTarget` and
   *  `stepInfo.stepId`. */
  toEnhancedProps(ctx: EnhanceContext): Record<string, unknown>;
}

// ─── Per-type schemas ───────────────────────────────────────────────────────

/** Common base for the "plain step family" disabled formula, used by
 *  InteractiveStep, InteractiveMultiStep, InteractiveGuided, and
 *  CodeBlockStep. Quiz/terminal/terminal-connect use a simpler form. */
function disabledForOrchestratedStep(ctx: EnhanceContext): boolean {
  // Don't disable the currently executing step — its handlers need to
  // run during section execution.
  return ctx.baseDisabled || !ctx.sectionRequirementsPassed || (ctx.isRunning && !ctx.isCurrentlyExecuting);
}

export const INTERACTIVE_STEP_SCHEMA: StepTypeSchema = {
  kind: 'plain',
  idPrefix: 'step',
  refTarget: 'stepRefs',
  toStepInfoExtension: (props) => ({
    targetAction: props.targetAction,
    refTarget: props.refTarget,
    targetValue: props.targetValue,
    targetComment: props.targetComment,
    requirements: props.requirements,
    postVerify: props.postVerify,
    skippable: props.skippable,
    showMe: props.showMe,
    isMultiStep: false,
    isGuided: false,
  }),
  toEnhancedProps: (ctx) => ({
    stepId: ctx.stepInfo.stepId,
    isEligibleForChecking: ctx.isEligibleForChecking,
    isCompleted: ctx.isCompleted,
    isCurrentlyExecuting: ctx.isCurrentlyExecuting,
    onStepComplete: ctx.onStepComplete,
    stepIndex: ctx.documentStepIndex,
    totalSteps: ctx.documentTotalSteps,
    sectionId: ctx.sectionId,
    sectionTitle: ctx.sectionTitle,
    onStepReset: ctx.onStepReset,
    disabled: disabledForOrchestratedStep(ctx),
    resetTrigger: ctx.resetTrigger,
  }),
};

export const INTERACTIVE_MULTISTEP_SCHEMA: StepTypeSchema = {
  kind: 'multistep',
  idPrefix: 'multistep',
  refTarget: 'multiStepRefs',
  toStepInfoExtension: (props) => ({
    targetAction: undefined,
    refTarget: undefined,
    targetValue: undefined,
    requirements: props.requirements,
    skippable: props.skippable,
    isMultiStep: true,
    isGuided: false,
  }),
  // Multi-step has the same enhanced surface as a plain step.
  toEnhancedProps: INTERACTIVE_STEP_SCHEMA.toEnhancedProps,
};

export const INTERACTIVE_GUIDED_SCHEMA: StepTypeSchema = {
  kind: 'guided',
  idPrefix: 'guided',
  // Guided step refs are stored in `multiStepRefs` per the pre-extraction
  // behaviour (line 1766 of the original). The ref Map is a bag of
  // executeStep handlers regardless of step kind.
  refTarget: 'multiStepRefs',
  toStepInfoExtension: (props) => ({
    targetAction: undefined,
    refTarget: undefined,
    targetValue: undefined,
    requirements: props.requirements,
    skippable: props.skippable,
    isMultiStep: false,
    isGuided: true,
  }),
  toEnhancedProps: INTERACTIVE_STEP_SCHEMA.toEnhancedProps,
};

export const INTERACTIVE_QUIZ_SCHEMA: StepTypeSchema = {
  kind: 'quiz',
  idPrefix: 'quiz',
  refTarget: 'none',
  toStepInfoExtension: (props) => ({
    targetAction: undefined,
    refTarget: undefined,
    targetValue: undefined,
    requirements: props.requirements,
    skippable: props.skippable,
    isMultiStep: false,
    isGuided: false,
    isQuiz: true,
  }),
  // Quiz omits isCurrentlyExecuting + onStepReset and uses the simple
  // `disabled` formula.
  toEnhancedProps: (ctx) => ({
    stepId: ctx.stepInfo.stepId,
    isEligibleForChecking: ctx.isEligibleForChecking,
    isCompleted: ctx.isCompleted,
    onStepComplete: ctx.onStepComplete,
    stepIndex: ctx.documentStepIndex,
    totalSteps: ctx.documentTotalSteps,
    sectionId: ctx.sectionId,
    sectionTitle: ctx.sectionTitle,
    disabled: ctx.baseDisabled,
    resetTrigger: ctx.resetTrigger,
  }),
};

export const TERMINAL_STEP_SCHEMA: StepTypeSchema = {
  kind: 'terminal',
  idPrefix: 'terminal',
  refTarget: 'none',
  toStepInfoExtension: (props) => ({
    targetAction: 'terminal',
    refTarget: undefined,
    targetValue: undefined,
    requirements: props.requirements,
    skippable: props.skippable,
    isMultiStep: false,
    isGuided: false,
  }),
  // Terminal mirrors Quiz's enhanced surface.
  toEnhancedProps: INTERACTIVE_QUIZ_SCHEMA.toEnhancedProps,
};

export const TERMINAL_CONNECT_STEP_SCHEMA: StepTypeSchema = {
  kind: 'terminal-connect',
  idPrefix: 'terminal-connect',
  refTarget: 'none',
  toStepInfoExtension: (props) => ({
    targetAction: 'terminal-connect',
    refTarget: undefined,
    targetValue: undefined,
    requirements: props.requirements,
    skippable: props.skippable,
    isMultiStep: false,
    isGuided: false,
  }),
  toEnhancedProps: INTERACTIVE_QUIZ_SCHEMA.toEnhancedProps,
};

export const CODE_BLOCK_STEP_SCHEMA: StepTypeSchema = {
  kind: 'codeblock',
  idPrefix: 'codeblock',
  refTarget: 'multiStepRefs',
  toStepInfoExtension: (props) => ({
    targetAction: 'code-block',
    refTarget: props.refTarget,
    targetValue: undefined,
    requirements: props.requirements,
    skippable: props.skippable,
    isMultiStep: true,
    isGuided: false,
  }),
  // CodeBlock has isCurrentlyExecuting (like a plain step) but no
  // onStepReset (like a quiz). Distinct shape — keep it explicit.
  toEnhancedProps: (ctx) => ({
    stepId: ctx.stepInfo.stepId,
    isEligibleForChecking: ctx.isEligibleForChecking,
    isCompleted: ctx.isCompleted,
    isCurrentlyExecuting: ctx.isCurrentlyExecuting,
    onStepComplete: ctx.onStepComplete,
    stepIndex: ctx.documentStepIndex,
    totalSteps: ctx.documentTotalSteps,
    sectionId: ctx.sectionId,
    sectionTitle: ctx.sectionTitle,
    disabled: disabledForOrchestratedStep(ctx),
    resetTrigger: ctx.resetTrigger,
  }),
};

/** Ordered array of every tracked step-type schema. The consumer in
 *  `interactive-section.tsx` builds a `Map<ComponentType, StepTypeSchema>`
 *  at module init by zipping this with the corresponding component
 *  identities (`InteractiveStep`, `InteractiveMultiStep`, etc.). */
export const STEP_TYPE_SCHEMAS: readonly StepTypeSchema[] = [
  INTERACTIVE_STEP_SCHEMA,
  INTERACTIVE_MULTISTEP_SCHEMA,
  INTERACTIVE_GUIDED_SCHEMA,
  INTERACTIVE_QUIZ_SCHEMA,
  TERMINAL_STEP_SCHEMA,
  TERMINAL_CONNECT_STEP_SCHEMA,
  CODE_BLOCK_STEP_SCHEMA,
];
