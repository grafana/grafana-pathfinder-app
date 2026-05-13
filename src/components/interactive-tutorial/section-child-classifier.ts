import React from 'react';

import { InteractiveStep } from './interactive-step';
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveGuided } from './interactive-guided';
import { InteractiveQuiz } from './interactive-quiz';
import { TerminalStep } from './terminal-step';
import { TerminalConnectStep } from './terminal-connect-step';
import { CodeBlockStep } from './code-block-step';
import type { InteractiveStepProps } from '../../types/component-props.types';
import type { ChildKind } from './step-section-utils';

/**
 * React component types whose presence as a direct child of an interactive
 * section counts as an "interactive" step the user must actually execute.
 *
 * ⚠ TRACKED STEP TYPE REGISTRY — site 4 of 4. Adding a new interactive step
 * component type requires updates in 4 places:
 *   1. content-renderer.tsx INTERACTIVE_STEP_TYPES
 *   2. content-renderer.tsx SECTION_TRACKED_STEP_TYPES
 *   3. interactive-section.tsx `stepComponents` useMemo branches
 *   4. section-child-classifier.ts INTERACTIVE_STEP_COMPONENT_TYPES (this set)
 *
 * Forgetting this set: the issue-#842 acknowledgement gate misclassifies the
 * new type as *passive*, so sections containing it will wrongly require
 * the user to click "Mark section as complete" after finishing the step.
 *
 * See .cursor/rules/tracked-step-types.mdc for the full checklist.
 */
const INTERACTIVE_STEP_COMPONENT_TYPES = new Set<unknown>([
  InteractiveMultiStep,
  InteractiveGuided,
  InteractiveQuiz,
  TerminalStep,
  TerminalConnectStep,
  CodeBlockStep,
]);

/**
 * Classify a direct child of an interactive section for the issue-#842
 * acknowledgement gate.
 *
 * - 'interactive': a tracked step that requires user action
 *   (button / highlight / formfill / navigate / hover / popout, plus the
 *    multistep / guided / quiz / terminal / code-block container types).
 * - 'passive': content the user is expected to read but not act on —
 *   noop InteractiveSteps, plus any non-tracked renderable child
 *   (markdown HTML, images, videos, plain text, html blocks, etc.).
 * - 'ignore': structurally invisible content (whitespace text nodes,
 *   booleans, null) — does not count for acknowledgement either way.
 */
export function classifySectionChild(child: React.ReactNode): ChildKind {
  if (child === null || child === undefined || typeof child === 'boolean') {
    return 'ignore';
  }
  if (typeof child === 'string') {
    return child.trim() === '' ? 'ignore' : 'passive';
  }
  if (typeof child === 'number') {
    return 'passive';
  }
  if (!React.isValidElement(child)) {
    return 'ignore';
  }
  const childType = (child as React.ReactElement).type;
  if (childType === InteractiveStep) {
    const targetAction = (child.props as InteractiveStepProps).targetAction;
    return targetAction === 'noop' ? 'passive' : 'interactive';
  }
  if (INTERACTIVE_STEP_COMPONENT_TYPES.has(childType)) {
    return 'interactive';
  }
  return 'passive';
}
