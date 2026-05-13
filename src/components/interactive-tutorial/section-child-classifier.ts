import React from 'react';

import { CodeBlockStep } from './code-block-step';
import { InteractiveGuided } from './interactive-guided';
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveQuiz } from './interactive-quiz';
import { InteractiveStep } from './interactive-step';
import { TerminalConnectStep } from './terminal-connect-step';
import { TerminalStep } from './terminal-step';
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
 *   4. section-child-classifier.ts INTERACTIVE_STEP_COMPONENT_TYPES (this set,
 *      lazily realised below)
 *
 * Forgetting this set: the issue-#842 acknowledgement gate misclassifies the
 * new type as *passive*, so sections containing it will wrongly require
 * the user to click "Mark section as complete" after finishing the work.
 *
 * See .cursor/rules/tracked-step-types.mdc for the full checklist.
 *
 * Note: `InteractiveStep` is handled by its own branch inside
 * `classifySectionChild` because its `targetAction` prop subdivides it
 * into interactive vs informational variants.
 *
 * Lazy realisation: the registry is computed on first call, not at
 * module-init time. The docs-retrieval barrel ↔ interactive-tutorial
 * cycle means a top-level `new Set([...])` resolves with `undefined`
 * entries for any component whose module hasn't finished loading.
 * Matches the well-documented `shouldNumberSectionChild` pattern in
 * interactive-section.tsx.
 */
let interactiveStepComponentTypes: Set<unknown> | null = null;
function getInteractiveStepComponentTypes(): Set<unknown> {
  if (!interactiveStepComponentTypes) {
    interactiveStepComponentTypes = new Set<unknown>([
      InteractiveMultiStep,
      InteractiveGuided,
      InteractiveQuiz,
      TerminalStep,
      TerminalConnectStep,
      CodeBlockStep,
    ]);
  }
  return interactiveStepComponentTypes;
}

/**
 * Classify a direct child of an interactive section for the issue-#842
 * acknowledgement gate.
 *
 * - 'interactive': a tracked step that requires user action
 *   (button / highlight / formfill / navigate / hover / popout / noop —
 *    plus the multistep / guided / quiz / terminal / code-block container
 *    types).
 *   `noop` steps are treated as interactive deliberately: per issue #842,
 *   "no-op blocks still count as interactive." This means a trailing run
 *   of noop steps does NOT trigger the gate (and authors are advised
 *   against using them as a gate-bypass workaround).
 * - 'passive': content the user is expected to read but not act on —
 *   markdown HTML, images, videos, plain text, html blocks, divs and any
 *   non-tracked renderable child.
 * - 'ignore': structurally invisible content (whitespace text nodes,
 *   booleans, null, undefined, empty fragments) — does not count for
 *   acknowledgement either way.
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
    // All InteractiveStep variants — including noop — count as interactive
    // per issue #842. The `nonNoopSteps` filter inside InteractiveSection
    // handles informational steps separately for completion counting; that
    // is independent of the acknowledgement gate.
    return 'interactive';
  }
  if (getInteractiveStepComponentTypes().has(childType)) {
    return 'interactive';
  }
  return 'passive';
}
