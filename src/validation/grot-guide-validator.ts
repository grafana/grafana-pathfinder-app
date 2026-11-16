import type { JsonBlock, JsonGuide, JsonGrotGuideBlock, GrotGuideScreen } from '../types/json-guide.types';

export interface GrotGuideIssue {
  code:
    | 'dangling_screen_ref'
    | 'duplicate_screen_id'
    | 'self_loop'
    | 'no_result_path'
    | 'empty_question'
    | 'unreachable_screen'
    | 'empty_result';
  severity: 'error' | 'warning';
  message: string;
  path: Array<string | number>;
  blockId?: string;
}

export function validateGrotGuideBlock(block: JsonGrotGuideBlock, blockPath: Array<string | number>): GrotGuideIssue[] {
  const issues: GrotGuideIssue[] = [];

  if (!block.welcome || !Array.isArray(block.screens)) {
    return issues;
  }

  const seenIds = new Set<string>();
  const screenMap = new Map<string, GrotGuideScreen>();

  block.screens.forEach((screen, screenIndex) => {
    if (seenIds.has(screen.id)) {
      issues.push({
        code: 'duplicate_screen_id',
        severity: 'warning',
        message: `Duplicate screen id '${screen.id}' found in grot-guide screens (duplicate_screen_id)`,
        path: [...blockPath, 'screens', screenIndex, 'id'],
        blockId: block.id,
      });
    } else {
      seenIds.add(screen.id);
    }
    screenMap.set(screen.id, screen);
  });

  block.screens.forEach((screen, screenIndex) => {
    if (screen.type === 'question' && Array.isArray(screen.options)) {
      screen.options.forEach((option, optionIndex) => {
        if (option.screenId === screen.id) {
          issues.push({
            code: 'self_loop',
            severity: 'error',
            message: `Self-loop detected: screen '${screen.id}' option '${option.text}' points to itself (self_loop)`,
            path: [...blockPath, 'screens', screenIndex, 'options', optionIndex, 'screenId'],
            blockId: block.id,
          });
        }
      });
    }
  });

  const reachable = new Set<string>();
  const queue: string[] = [];

  if (Array.isArray(block.welcome.ctas)) {
    for (const cta of block.welcome.ctas) {
      if (cta.screenId && !reachable.has(cta.screenId)) {
        reachable.add(cta.screenId);
        queue.push(cta.screenId);
      }
    }
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const screen = screenMap.get(currentId);
    if (screen && screen.type === 'question' && Array.isArray(screen.options)) {
      for (const option of screen.options) {
        if (option.screenId && !reachable.has(option.screenId)) {
          reachable.add(option.screenId);
          queue.push(option.screenId);
        }
      }
    }
  }

  block.screens.forEach((screen, screenIndex) => {
    if (!reachable.has(screen.id)) {
      issues.push({
        code: 'unreachable_screen',
        severity: 'warning',
        message: `Screen '${screen.id}' is unreachable from welcome screen (unreachable_screen)`,
        path: [...blockPath, 'screens', screenIndex],
        blockId: block.id,
      });
    }
  });

  const reverseAdjacency = new Map<string, string[]>();
  const resultScreenIds: string[] = [];

  screenMap.forEach((screen, id) => {
    if (screen.type === 'result') {
      resultScreenIds.push(id);
    } else if (screen.type === 'question' && Array.isArray(screen.options)) {
      for (const option of screen.options) {
        const list = reverseAdjacency.get(option.screenId) ?? [];
        list.push(id);
        reverseAdjacency.set(option.screenId, list);
      }
    }
  });

  const canReachResult = new Set<string>(resultScreenIds);
  const reverseQueue = [...resultScreenIds];

  while (reverseQueue.length > 0) {
    const currentId = reverseQueue.shift()!;
    const incoming = reverseAdjacency.get(currentId) ?? [];
    for (const pred of incoming) {
      if (!canReachResult.has(pred)) {
        canReachResult.add(pred);
        reverseQueue.push(pred);
      }
    }
  }

  const reportedNoResultScreens = new Set<string>();
  block.screens.forEach((screen, screenIndex) => {
    if (reachable.has(screen.id) && !canReachResult.has(screen.id)) {
      if (!reportedNoResultScreens.has(screen.id)) {
        reportedNoResultScreens.add(screen.id);
        issues.push({
          code: 'no_result_path',
          severity: 'error',
          message: `Screen '${screen.id}' has no path to any result screen (no_result_path)`,
          path: [...blockPath, 'screens', screenIndex],
          blockId: block.id,
        });
      }
    }
  });

  const reportedEmptyResults = new Set<string>();
  block.screens.forEach((screen, screenIndex) => {
    if (screen.type === 'result' && reachable.has(screen.id)) {
      if (!screen.links || screen.links.length === 0) {
        if (!reportedEmptyResults.has(screen.id)) {
          reportedEmptyResults.add(screen.id);
          issues.push({
            code: 'empty_result',
            severity: 'warning',
            message: `Reachable result screen '${screen.id}' has no links (empty_result)`,
            path: [...blockPath, 'screens', screenIndex],
            blockId: block.id,
          });
        }
      }
    }
  });

  return issues;
}

export function validateGrotGuideGraphsInBlocks(
  blocks: readonly JsonBlock[],
  basePath: Array<string | number> = ['blocks']
): GrotGuideIssue[] {
  const issues: GrotGuideIssue[] = [];

  function visitBlock(block: JsonBlock, path: Array<string | number>): void {
    if (block.type === 'grot-guide') {
      issues.push(...validateGrotGuideBlock(block as JsonGrotGuideBlock, path));
    }

    if ('blocks' in block && Array.isArray(block.blocks)) {
      block.blocks.forEach((child, i) => {
        visitBlock(child, [...path, 'blocks', i]);
      });
    }

    if (block.type === 'conditional') {
      if ('whenTrue' in block && Array.isArray(block.whenTrue)) {
        block.whenTrue.forEach((child, i) => {
          visitBlock(child, [...path, 'whenTrue', i]);
        });
      }
      if ('whenFalse' in block && Array.isArray(block.whenFalse)) {
        block.whenFalse.forEach((child, i) => {
          visitBlock(child, [...path, 'whenFalse', i]);
        });
      }
    }
  }

  if (Array.isArray(blocks)) {
    blocks.forEach((block, i) => {
      visitBlock(block, [...basePath, i]);
    });
  }

  return issues;
}

export function validateGrotGuideGraphs(guide: JsonGuide): GrotGuideIssue[] {
  return validateGrotGuideGraphsInBlocks(guide.blocks);
}
