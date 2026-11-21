import type { ContentJson } from '../../../../types/package.types';
import { BLOCK_SUITES } from './block-rules';
import { GUIDE_SUITE } from './guide-rules';
import { KIND_SUITES } from './kind-rules';
import { joinPath, walk, type GuideKind, type GuideSuite } from './suite';

export { suite } from './suite';
export type { GuideKind } from './suite';
export { KindSchema } from './kind-schema';

export const MAX_HINTS = 5;

const KIND_NOT_GIVEN = {
  code: 'KIND_NOT_GIVEN',
  steer:
    'No guide kind was declared, so kind checks were skipped. Declare `kind` when you call pathfinder_create_package.',
};

export interface BlockHint {
  blockId: string;
  path: string;
  code: string;
  steer: string;
}

export interface GuideHint {
  code: string;
  steer: string;
  blockId?: string;
  path?: string;
}

export interface QualityHints {
  guide: GuideHint[];
  blocks: BlockHint[];
  more?: number;
}

export function blockHints(content: ContentJson, verifiedSelectors: ReadonlySet<string> = new Set()): BlockHint[] {
  const hints: BlockHint[] = [];
  for (const { block, path, ...ctx } of walk(content.blocks)) {
    for (const { appliesTo, rules } of BLOCK_SUITES) {
      if (!appliesTo.has(block.type)) {
        continue;
      }
      for (const rule of rules) {
        const result = rule.check(block, { ...ctx, verifiedSelectors });
        const subPaths = result === true ? [''] : result === false ? [] : result;
        for (const sub of subPaths) {
          hints.push({ blockId: block.id ?? path, path: joinPath(path, sub), code: rule.code, steer: rule.steer });
        }
      }
    }
  }
  return hints;
}

export function guideHints(content: ContentJson, kind?: GuideKind): GuideHint[] {
  const suites: GuideSuite[] = kind ? [GUIDE_SUITE, KIND_SUITES[kind]] : [GUIDE_SUITE];
  const hints = suites.flatMap(({ rules }) =>
    rules.flatMap((rule) => rule.check(content).map((flag) => ({ code: rule.code, steer: rule.steer, ...flag })))
  );
  return kind ? hints : [...hints, KIND_NOT_GIVEN];
}

export function mutationQualityHints(
  before: ContentJson,
  after: ContentJson,
  verifiedSelectors?: ReadonlySet<string>
): QualityHints | undefined {
  const seen = new Set(blockHints(before, verifiedSelectors).map((hint) => `${hint.blockId}:${hint.code}`));
  const added = blockHints(after, verifiedSelectors).filter((hint) => !seen.has(`${hint.blockId}:${hint.code}`));
  const more = added.length - MAX_HINTS;
  return added.length === 0
    ? undefined
    : { guide: [], blocks: added.slice(0, MAX_HINTS), ...(more > 0 ? { more } : {}) };
}

export function currentQualityHints(
  content: ContentJson,
  kind?: GuideKind,
  verifiedSelectors?: ReadonlySet<string>
): QualityHints | undefined {
  const guide = guideHints(content, kind);
  const blocks = blockHints(content, verifiedSelectors);
  return guide.length + blocks.length === 0 ? undefined : { guide, blocks };
}
