import type { StepInfo } from '../../types/component-props.types';

export interface ResumeInfo {
  nextStepIndex: number;
  remainingSteps: number;
  isResume: boolean;
}

/**
 * Computes resume button state for an interactive section.
 *
 * Noop steps are excluded from `remainingSteps` because they are informational
 * markers, not interactive actions. This prevents the button from showing an
 * inflated count like "Resume (5 steps)" when only 3 are real.
 */
export function getResumeInfo(stepComponents: StepInfo[], currentStepIndex: number): ResumeInfo {
  if (stepComponents.length === 0) {
    return { nextStepIndex: 0, remainingSteps: 0, isResume: false };
  }

  const allCompleted = currentStepIndex >= stepComponents.length;
  const remainingSteps = allCompleted
    ? 0
    : stepComponents.slice(currentStepIndex).filter((s) => s.targetAction !== 'noop').length;

  return {
    nextStepIndex: currentStepIndex,
    remainingSteps,
    isResume: !allCompleted && currentStepIndex > 0,
  };
}

/**
 * Computes per-step eligibility for a sequential interactive section.
 *
 * The first step is always eligible. Subsequent steps are eligible only when
 * every preceding step is either completed or a noop (informational) step.
 */
export function computeStepEligibility(stepComponents: StepInfo[], completedSteps: ReadonlySet<string>): boolean[] {
  return stepComponents.map((_, index) => {
    if (index === 0) {
      return true;
    }
    return stepComponents
      .slice(0, index)
      .every((prevStep) => prevStep.targetAction === 'noop' || completedSteps.has(prevStep.stepId));
  });
}

/**
 * Classification of a direct child inside an interactive section, used to
 * drive the issue-#842 acknowledgement gate.
 *
 * - 'interactive': a tracked step the user must execute (button, highlight,
 *   formfill, multistep, guided, quiz, terminal, code-block, or even a
 *   `noop` InteractiveStep — see `classifySectionChild` for details).
 * - 'passive': content the user is expected to read but not act on
 *   (markdown, image, video, html, plain text, divs).
 * - 'ignore': structurally invisible content (whitespace, null, booleans).
 */
export type ChildKind = 'interactive' | 'passive' | 'ignore';

export interface AcknowledgementAnalysis {
  /**
   * The section has trailing passive content the user could skip past
   * once all interactive steps are done, OR the section is composed
   * entirely of passive content. In either case the user must click
   * "Mark section as complete" before the section is treated as done.
   */
  needsAcknowledgement: boolean;
  /**
   * The section contains zero interactive children. The main action
   * button collapses down to a single "Mark section as complete" CTA.
   */
  isAllPassive: boolean;
}

/**
 * Decides whether a section requires explicit user acknowledgement based
 * on the document-order classification of its children.
 *
 * Rules (issue #842):
 * - Mid-section passive content (e.g. `markdown, interactive, interactive`)
 *   is read naturally as the user works through the section and does NOT
 *   require acknowledgement.
 * - Trailing passive content after the last interactive child
 *   (e.g. `interactive, interactive, markdown`) requires acknowledgement —
 *   otherwise the section auto-completes the moment the last interactive
 *   finishes and the trailing content is hidden by auto-collapse.
 * - A section with zero interactive children (100% passive) is treated as
 *   "all trailing" — the only available action is acknowledgement.
 * - `'ignore'` entries (whitespace, nulls) are skipped — they neither
 *   trigger the gate nor anchor the "last interactive" position.
 */
export function analyzeAcknowledgement(kinds: ChildKind[]): AcknowledgementAnalysis {
  let lastInteractiveIdx = -1;
  let hasPassive = false;
  let hasInteractive = false;

  kinds.forEach((kind, idx) => {
    if (kind === 'interactive') {
      lastInteractiveIdx = idx;
      hasInteractive = true;
    } else if (kind === 'passive') {
      hasPassive = true;
    }
  });

  if (!hasPassive) {
    return { needsAcknowledgement: false, isAllPassive: false };
  }

  if (!hasInteractive) {
    return { needsAcknowledgement: true, isAllPassive: true };
  }

  const hasTrailingPassive = kinds.some((kind, idx) => idx > lastInteractiveIdx && kind === 'passive');
  return { needsAcknowledgement: hasTrailingPassive, isAllPassive: false };
}
