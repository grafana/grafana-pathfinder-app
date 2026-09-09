/**
 * Canonical step id for an addressable block — identical to the value
 * `json-parser.ts` assigns to `props.stepId` (author id, else
 * {@link deriveStepId} over the block's parsed identity).
 *
 * Two walks consume it and neither can derive the id itself: the AI-fix apply
 * path, which materializes ids onto a guide clone so a patch can address an
 * anonymous block, and `computeGuideBlockIndex`, which keys completion
 * positions by the id the runtime dispatches under.
 *
 * It must cover every block type that can emit completion evidence —
 * `COMPLETION_AFFORDANCE_BLOCK_TYPES` plus the blocking-datasource shape of
 * `input`. A completable type this function misses resolves no position, so a
 * guide built on it reads 0% while looking healthy.
 * `src/lib/guide-stats/progress.parity.test.ts` pins the coverage to the
 * parser over that whole set.
 *
 * Lives in `global-state/` (Tier 1) beside `step-id.ts` so the counter
 * (`lib/guide-stats`, Tier 1) and the assistant integration (Tier 3) can both
 * import it.
 */

import { assertExhaustive } from '../lib/assert-exhaustive';
import type { BlockIndexOptions, BlockStepIdContext } from '../lib/guide-stats';
import {
  type JsonBlock,
  type JsonChallengeBlock,
  type JsonCodeBlockBlock,
  type JsonGuidedBlock,
  type JsonInputBlock,
  type JsonInteractiveBlock,
  type JsonMultistepBlock,
  type JsonQuizBlock,
  type JsonTerminalBlock,
  type JsonTerminalConnectBlock,
} from '../types/json-guide.types';
import { deriveStepId } from './step-id';

export function resolveStepIdForBlock(block: JsonBlock, context: BlockStepIdContext): string | undefined {
  const { parentSectionId: sectionId, index } = context;
  const authorId = block.id || undefined;

  switch (block.type) {
    case 'interactive': {
      const b = block as JsonInteractiveBlock;
      return (
        authorId ??
        deriveStepId({
          sectionId,
          index,
          action: b.action ?? b.targetAction,
          refTarget: b.reftarget ?? b.refTarget,
        })
      );
    }
    case 'multistep': {
      const first = (block as JsonMultistepBlock).steps?.[0];
      return (
        authorId ??
        deriveStepId({
          sectionId,
          index,
          action: first?.action ?? first?.targetAction,
          refTarget: first?.reftarget ?? first?.refTarget,
          variant: 'multistep',
        })
      );
    }
    case 'guided': {
      const first = (block as JsonGuidedBlock).steps?.[0];
      return (
        authorId ??
        deriveStepId({
          sectionId,
          index,
          action: first?.action ?? first?.targetAction,
          refTarget: first?.reftarget ?? first?.refTarget,
          variant: 'guided',
        })
      );
    }
    case 'quiz': {
      return authorId ?? deriveStepId({ sectionId, index, action: 'quiz', variant: (block as JsonQuizBlock).question });
    }
    case 'terminal': {
      return (
        authorId ??
        deriveStepId({ sectionId, index, action: 'terminal', refTarget: (block as JsonTerminalBlock).command })
      );
    }
    case 'terminal-connect': {
      return (
        authorId ??
        deriveStepId({
          sectionId,
          index,
          action: 'terminal-connect',
          refTarget: (block as JsonTerminalConnectBlock).buttonText,
        })
      );
    }
    case 'challenge': {
      return (
        authorId ??
        deriveStepId({ sectionId, index, action: 'challenge', refTarget: (block as JsonChallengeBlock).title })
      );
    }
    case 'code-block': {
      return (
        authorId ??
        deriveStepId({
          sectionId,
          index,
          action: 'code-block',
          refTarget: (block as JsonCodeBlockBlock).reftarget,
        })
      );
    }
    case 'input': {
      // Only the blocking datasource check parses as a tracked step; every
      // other input renders passive and the parser gives it no stepId at all.
      const b = block as JsonInputBlock;
      const hasDataCheck = b.inputType === 'datasource' && Boolean(b.dataCheckQuery?.trim());
      if (!hasDataCheck || !b.dataCheckBlocking) {
        return undefined;
      }
      return authorId ?? deriveStepId({ sectionId, index, action: 'datasource-check', refTarget: b.variableName });
    }
    case 'section':
    case 'markdown':
    case 'divider':
    case 'html':
    case 'image':
    case 'video':
    case 'callout':
    case 'conditional':
    case 'assistant':
    case 'grot-guide':
    case 'collapsible':
    case 'snippet-ref':
      return undefined;
    default:
      assertExhaustive(block);
      return undefined;
  }
}

/**
 * The same resolver in the shape `computeGuideBlockIndex` injects.
 *
 * The counter is deliberately dependency-free, so it walks the structural
 * `CountableBlock` rather than the `JsonBlock` union this resolver switches
 * over. Every guide the counter is handed is guide JSON, and the resolver only
 * ever reads fields the union declares.
 */
export const resolveCountedBlockStepId: NonNullable<BlockIndexOptions['resolveStepId']> = (block, context) =>
  resolveStepIdForBlock(block as unknown as JsonBlock, context);
