/**
 * Guided-block verb validation.
 *
 * `JsonGuidedBlockSchema` reuses `JsonStepSchema`, which admits every authorable
 * verb, but `GuidedHandler` only drives `GUIDED_ACTION_TYPES`. A guided step
 * carrying `navigate` or `popout` therefore passes Zod and then fails at
 * runtime. Narrowing the shared step schema is not an option — a `popout` step
 * inside a *multistep* is valid and pinned by `validate-guide.test.ts` — so the
 * restriction lives here, as a post-Zod check over guided blocks only.
 *
 * Snippet bodies carry the same block list without a guide root, so the walk is
 * exposed over `JsonBlock[]` and the guide entry point is a thin wrapper.
 */
import type { JsonBlock, JsonGuide, JsonStep } from '../types/json-guide.types';
import { GUIDED_ACTION_TYPES, isGuidedActionType } from '../types/interactive-actions.types';

export interface GuidedActionIssue {
  message: string;
  path: Array<string | number>;
}

const SUPPORTED = GUIDED_ACTION_TYPES.join(', ');

/**
 * Collect every guided step whose verb the guided handler cannot drive.
 * Recurses through the containers that can nest a guided block: `section` and
 * `assistant` (`blocks`), and `conditional` (`whenTrue` / `whenFalse`).
 */
export function validateGuidedActionsInBlocks(blocks: readonly JsonBlock[]): GuidedActionIssue[] {
  const issues: GuidedActionIssue[] = [];

  function visitGuidedStep(step: JsonStep, path: Array<string | number>): void {
    // Runs only after Zod succeeded, so `action` is populated.
    if (isGuidedActionType(step.action)) {
      return;
    }
    issues.push({
      message: `guided steps cannot use "${step.action}" — the guided block waits for the reader to act, and only ${SUPPORTED} can be detected. Use a separate interactive block for "${step.action}", or move this step into a multistep block.`,
      path,
    });
  }

  function visitBlock(block: JsonBlock, path: Array<string | number>): void {
    if (block.type === 'guided' && Array.isArray(block.steps)) {
      block.steps.forEach((step, i) => {
        visitGuidedStep(step, [...path, 'steps', i, 'action']);
      });
    }

    if ('blocks' in block && Array.isArray(block.blocks)) {
      block.blocks.forEach((child, i) => visitBlock(child, [...path, 'blocks', i]));
    }

    if (block.type === 'conditional') {
      if ('whenTrue' in block && Array.isArray(block.whenTrue)) {
        block.whenTrue.forEach((child, i) => visitBlock(child, [...path, 'whenTrue', i]));
      }
      if ('whenFalse' in block && Array.isArray(block.whenFalse)) {
        block.whenFalse.forEach((child, i) => visitBlock(child, [...path, 'whenFalse', i]));
      }
    }
  }

  blocks.forEach((block, i) => visitBlock(block, ['blocks', i]));

  return issues;
}

export function validateGuidedActions(guide: JsonGuide): GuidedActionIssue[] {
  return validateGuidedActionsInBlocks(guide.blocks);
}
