import { readJsonGuideAliasedField } from '../../../../types/json-guide-aliases';
import type { JsonBlock } from '../../../../types/json-guide.types';
import type { ContentJson } from '../../../../types/package.types';
import { CONTAINER_CHILD_KEYS } from '../../../utils/package-io/tree';

export type BlockType = JsonBlock['type'];
export type GuideKind = 'reference' | 'teach' | 'walkthrough';
export type SuiteScope = 'guide' | GuideKind;

export interface BlockContext {
  parent: JsonBlock | undefined;
  ancestors: JsonBlock[];
  index: number;
  siblings: JsonBlock[];
}

export interface RuleContext extends BlockContext {
  verifiedSelectors: ReadonlySet<string>;
}

export interface Flag {
  blockId?: string;
  path?: string;
}

export interface BlockRule<B extends JsonBlock = JsonBlock> {
  code: string;
  /** `true` flags the block, an array flags sub-paths of it (`''` is the block itself). */
  check: (block: B, ctx: RuleContext) => boolean | string[];
  steer: string;
}

export interface GuideRule {
  code: string;
  check: (content: ContentJson) => Flag[];
  steer: string;
}

export interface BlockSuite {
  name: string;
  appliesTo: ReadonlySet<BlockType>;
  rules: BlockRule[];
}

export interface GuideSuite {
  name: string;
  appliesTo: SuiteScope;
  rules: GuideRule[];
}

interface SuiteFn {
  <T extends BlockType>(
    name: string,
    appliesTo: readonly T[],
    rules: Array<BlockRule<Extract<JsonBlock, { type: T }>>>
  ): BlockSuite;
  (name: string, appliesTo: SuiteScope, rules: GuideRule[]): GuideSuite;
}

export const suite = ((name: string, appliesTo: readonly BlockType[] | SuiteScope, rules: unknown[]) =>
  typeof appliesTo === 'string'
    ? { name, appliesTo, rules }
    : { name, appliesTo: new Set<BlockType>(appliesTo), rules }) as SuiteFn;

export interface BlockEntry extends BlockContext {
  block: JsonBlock;
  path: string;
}

export function* walk(blocks: unknown, prefix = 'blocks', ancestors: JsonBlock[] = []): Generator<BlockEntry> {
  if (!Array.isArray(blocks)) {
    return;
  }
  const siblings = blocks as JsonBlock[];
  for (let index = 0; index < siblings.length; index++) {
    const block = siblings[index];
    if (typeof block !== 'object' || block === null) {
      continue;
    }
    const path = `${prefix}[${index}]`;
    yield { block, path, parent: ancestors[ancestors.length - 1], ancestors, index, siblings };
    for (const key of CONTAINER_CHILD_KEYS[block.type] ?? []) {
      yield* walk((block as unknown as Record<string, unknown>)[key], `${path}.${key}`, [...ancestors, block]);
    }
  }
}

export interface ActionUnit {
  path: string;
  node: Record<string, unknown>;
}

/** The blocks that carry an action: an interactive block itself, or each step of a multistep or guided block. */
export function actionUnits(block: JsonBlock): ActionUnit[] {
  if (block.type === 'multistep' || block.type === 'guided') {
    return (Array.isArray(block.steps) ? block.steps : []).map((step, i) => ({
      path: `steps[${i}]`,
      node: step as unknown as Record<string, unknown>,
    }));
  }
  return [{ path: '', node: block as unknown as Record<string, unknown> }];
}

export const unitField = (unit: ActionUnit, key: string): unknown => readJsonGuideAliasedField(unit.node, key);

export const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('.');

export function hasOnPage(unit: ActionUnit, block: JsonBlock, ancestors: JsonBlock[]): boolean {
  return [unit.node, block, ...ancestors].some((node) => {
    const requirements = (node as { requirements?: unknown }).requirements;
    return Array.isArray(requirements) && requirements.some((r) => typeof r === 'string' && r.startsWith('on-page:'));
  });
}
