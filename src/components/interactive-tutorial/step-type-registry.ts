/**
 * Step-type schema registry — single source of truth for per-step-type
 * orchestration data inside `interactive-section.tsx`:
 *   1. The `stepComponents` useMemo (builds `StepInfo` records).
 *   2. The `enhancedChildren` useMemo (clones each child with the
 *      type-specific enhanced props).
 *
 * Adding a new step type means editing this registry and
 * `section-child-classifier.ts`'s `INTERACTIVE_STEP_COMPONENT_TYPES`.
 * See `.cursor/rules/tracked-step-types.mdc` for the full checklist.
 *
 * The registry intentionally has no imports of the step component
 * modules. That keeps it a pure schema and lets the consumer
 * (`interactive-section.tsx`) build the component-identity ↔ schema
 * lookup at the call site, so the registry's unit tests need no
 * jest.mock of the heavy step modules.
 */

import type { StepInfo } from '../../types/component-props.types';
import type { StepCountingBlockType } from '../../types/json-guide.types';

/** Discriminant for the tracked step component types. */
export type StepTypeKind =
  'plain' | 'multistep' | 'guided' | 'quiz' | 'terminal' | 'terminal-connect' | 'codeblock' | 'challenge';

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

/** Parse-time key the JSON parser emits on `ParsedElement.type` for this step kind. */
export type ParseTypeKey =
  | 'interactive-step'
  | 'interactive-multi-step'
  | 'interactive-guided'
  | 'quiz-block'
  | 'terminal-step'
  | 'terminal-connect-step'
  | 'code-block-step'
  | 'challenge-block';

/** Schema for one tracked step component type. */
export interface StepTypeSchema {
  kind: StepTypeKind;
  /** ParsedElement.type value emitted by the JSON parser for this kind.
   *  Phase 1 collapses content-renderer's INTERACTIVE_STEP_TYPES and
   *  SECTION_TRACKED_STEP_TYPES into a read of this field. */
  parseTypeKey: ParseTypeKey;
  /** JSON authoring block type that parses into this kind. */
  jsonBlockType: StepCountingBlockType;
  /** Used to build per-type stepIds (`${sectionId}-${idPrefix}-${n}`). */
  idPrefix: 'step' | 'multistep' | 'guided' | 'quiz' | 'terminal' | 'terminal-connect' | 'codeblock' | 'challenge';
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
  parseTypeKey: 'interactive-step',
  jsonBlockType: 'interactive',
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
  parseTypeKey: 'interactive-multi-step',
  jsonBlockType: 'multistep',
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
  parseTypeKey: 'interactive-guided',
  jsonBlockType: 'guided',
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
  parseTypeKey: 'quiz-block',
  jsonBlockType: 'quiz',
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
  parseTypeKey: 'terminal-step',
  jsonBlockType: 'terminal',
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
  parseTypeKey: 'terminal-connect-step',
  jsonBlockType: 'terminal-connect',
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
  parseTypeKey: 'code-block-step',
  jsonBlockType: 'code-block',
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

export const CHALLENGE_BLOCK_SCHEMA: StepTypeSchema = {
  kind: 'challenge',
  parseTypeKey: 'challenge-block',
  jsonBlockType: 'challenge',
  idPrefix: 'challenge',
  // Challenge runs its own setup/check lifecycle; it doesn't participate
  // in the section's ref-driven Do Section orchestration.
  refTarget: 'none',
  toStepInfoExtension: (props) => ({
    targetAction: undefined,
    refTarget: undefined,
    targetValue: undefined,
    requirements: props.requirements,
    skippable: props.skippable,
    isMultiStep: false,
    isGuided: false,
  }),
  // Mirrors Quiz: challenges don't need isCurrentlyExecuting or
  // onStepReset — the block manages its own internal state machine.
  toEnhancedProps: INTERACTIVE_QUIZ_SCHEMA.toEnhancedProps,
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
  CHALLENGE_BLOCK_SCHEMA,
];

/**
 * The `kind` value of every registered step schema, as a `const`-asserted
 * tuple so TypeScript flags additions and removals via the
 * `step-type-registry.tripwire.test.ts` parity check.
 */
export const STEP_TYPE_KIND_KEYS = [
  'plain',
  'multistep',
  'guided',
  'quiz',
  'terminal',
  'terminal-connect',
  'codeblock',
  'challenge',
] as const;

/** Parse-time keys derived from the registry. Phase 1 substitutes this
 *  set for the duplicated `INTERACTIVE_STEP_TYPES` / `SECTION_TRACKED_STEP_TYPES`
 *  string sets in `content-renderer.tsx`. */
export const STEP_TYPE_PARSE_KEYS: readonly ParseTypeKey[] = STEP_TYPE_SCHEMAS.map((s) => s.parseTypeKey);
