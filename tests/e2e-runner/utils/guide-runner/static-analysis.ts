import { isInteractiveBlockType } from '../../../../src/constants/json-guide-classification';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  GUIDE_INITIAL_TIMEOUT_MS,
  STEP_OVERHEAD_TIMEOUT_MS,
  STEP_DEADLINE_CLEANUP_GRACE_MS,
  TIMEOUT_PER_GUIDED_SUBSTEP_MS,
  TIMEOUT_PER_MULTISTEP_ACTION_MS,
} from './constants';

export function countInteractiveBlocks(guide: unknown): number {
  let count = 0;

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }

    const block = node as Record<string, unknown>;

    if (isInteractiveBlockType(block.type) || block.type === 'snippet-ref') {
      count++;
    }

    walk(block.blocks);
    walk(block.whenTrue);
    walk(block.whenFalse);
  }

  walk(guide);
  return count;
}

export function estimateGuideTimeoutFromContent(content: string): number {
  const guide = JSON.parse(content) as unknown;
  let stepCount = 0;
  let stepBudget = 0;

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const block = node as Record<string, unknown>;
    if (isInteractiveBlockType(block.type) || block.type === 'snippet-ref') {
      stepCount++;
      const actions = Array.isArray(block.steps) ? block.steps.length : 0;
      const timeout =
        block.type === 'guided'
          ? DEFAULT_STEP_TIMEOUT_MS + actions * TIMEOUT_PER_GUIDED_SUBSTEP_MS
          : block.type === 'multistep'
            ? DEFAULT_STEP_TIMEOUT_MS + actions * TIMEOUT_PER_MULTISTEP_ACTION_MS
            : DEFAULT_STEP_TIMEOUT_MS;
      stepBudget += timeout * 2 + STEP_OVERHEAD_TIMEOUT_MS;
    }
    walk(block.blocks);
    walk(block.whenTrue);
    walk(block.whenFalse);
  }

  walk(guide);
  return GUIDE_INITIAL_TIMEOUT_MS + stepBudget + (stepCount > 0 ? STEP_DEADLINE_CLEANUP_GRACE_MS : 0);
}
