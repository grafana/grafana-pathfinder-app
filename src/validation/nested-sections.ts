import { formatPath } from './errors';

export interface NestedSectionIssue {
  path: Array<string | number>;
  message: string;
}

const CHILD_KEYS = ['blocks', 'whenTrue', 'whenFalse'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(block: Record<string, unknown>): string {
  return typeof block.id === 'string' && block.id ? `section "${block.id}"` : 'section';
}

/**
 * Finds sections beneath another section, directly or through conditional and
 * assistant branches. The schema rejects these structurally, but the union
 * error it produces does not name the block, so authoring surfaces report these
 * instead.
 */
export function findNestedSections(
  blocks: unknown,
  basePath: Array<string | number> = ['blocks']
): NestedSectionIssue[] {
  const issues: NestedSectionIssue[] = [];

  const walk = (list: unknown, path: Array<string | number>, outer: string | null): void => {
    if (!Array.isArray(list)) {
      return;
    }
    list.forEach((block, index) => {
      if (!isRecord(block)) {
        return;
      }
      const blockPath = [...path, index];
      let nextOuter = outer;
      if (block.type === 'section') {
        if (outer) {
          issues.push({
            path: blockPath,
            message: `${formatPath(blockPath)}: ${describe(block)} is nested inside ${outer}. Sections cannot contain other sections, including through conditional or assistant blocks; make it a sibling section instead.`,
          });
        }
        nextOuter = outer ?? describe(block);
      }
      for (const key of CHILD_KEYS) {
        walk(block[key], [...blockPath, key], nextOuter);
      }
    });
  };

  walk(blocks, basePath, null);
  return issues;
}

/** True when `ancestor` is a prefix of (or equal to) `path`. */
export function isPathAtOrAbove(ancestor: readonly PropertyKey[], path: readonly PropertyKey[]): boolean {
  return ancestor.length <= path.length && ancestor.every((segment, i) => segment === path[i]);
}
