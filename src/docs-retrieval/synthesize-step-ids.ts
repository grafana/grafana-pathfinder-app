/**
 * Synthesize stable runtime IDs for interactive blocks + sub-steps.
 *
 * The AI auto-heal patch model addresses targets by `id`. Authors aren't
 * required to set ids on every block, so we synthesize a deterministic
 * content-hash id for anything missing one when a guide is parsed.
 *
 * Properties:
 * - Pure (no I/O); mutates a deep clone, never the input.
 * - Deterministic: identical guide content always produces identical ids.
 * - Stable across reloads: re-parsing the same content reproduces the same
 *   ids without needing to persist anything.
 * - Stable across edits: an edited step gets a new id, so an old AI fix
 *   patch can't silently apply to a modified step.
 * - Author ids are preserved untouched; only missing ids are filled.
 * - Collision-safe: if two distinct blocks hash to the same value, the
 *   second gets a `-2`, third `-3`, etc.
 *
 * Synthesized ids are prefixed with `_ai-fix:` so authors / lint can
 * distinguish them at a glance from author-set ids.
 */

import type {
  JsonBlock,
  JsonGuide,
  JsonGuidedBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonSectionBlock,
  JsonConditionalBlock,
  JsonStep,
} from '../types/json-guide.types';

const SYNTHESIZED_ID_PREFIX = '_ai-fix:';

/** FNV-1a 32-bit hash → 8 hex chars. Fast, sync, deterministic. */
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Build a hash input that uniquely identifies a block by its content.
 * Excludes the `id` field itself (which we may be about to set), and the
 * editor-only `_meta` annotation (which mutates as authors edit). Includes
 * the block's path so two identical buttons at different positions don't
 * collide.
 */
function hashKeyForBlock(block: JsonBlock | JsonStep, path: string): string {
  const sanitized = { ...(block as unknown as Record<string, unknown>) };
  delete sanitized.id;
  delete sanitized._meta;
  // Drop nested arrays — they'll get their own ids via recursion.
  delete sanitized.blocks;
  delete sanitized.whenTrue;
  delete sanitized.whenFalse;
  delete sanitized.steps;
  return `${path}|${JSON.stringify(sanitized)}`;
}

function synthesizedId(used: Set<string>, hashInput: string): string {
  const baseHash = fnv1a(hashInput);
  let id = `${SYNTHESIZED_ID_PREFIX}${baseHash}`;
  let counter = 2;
  while (used.has(id)) {
    id = `${SYNTHESIZED_ID_PREFIX}${baseHash}-${counter}`;
    counter += 1;
  }
  used.add(id);
  return id;
}

function isInteractiveBlock(block: JsonBlock): block is JsonInteractiveBlock {
  return block.type === 'interactive';
}

function isStepContainer(block: JsonBlock): block is JsonMultistepBlock | JsonGuidedBlock {
  return block.type === 'multistep' || block.type === 'guided';
}

function isBlockContainer(block: JsonBlock): block is JsonSectionBlock | JsonConditionalBlock {
  return block.type === 'section' || block.type === 'conditional';
}

function ensureId(target: { id?: string }, used: Set<string>, hashInput: string): void {
  if (target.id) {
    used.add(target.id);
    return;
  }
  target.id = synthesizedId(used, hashInput);
}

function walkBlocks(blocks: JsonBlock[], used: Set<string>, path: string): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const childPath = `${path}.blocks[${i}]`;

    if (isInteractiveBlock(block) || isStepContainer(block) || isBlockContainer(block)) {
      ensureId(block, used, hashKeyForBlock(block, childPath));
    }

    if (isStepContainer(block)) {
      for (let j = 0; j < block.steps.length; j++) {
        const step = block.steps[j]!;
        ensureId(step as JsonStep & { id?: string }, used, hashKeyForBlock(step, `${childPath}.steps[${j}]`));
      }
    } else if (block.type === 'section') {
      walkBlocks(block.blocks, used, childPath);
    } else if (block.type === 'conditional') {
      walkBlocks(block.whenTrue, used, `${childPath}.whenTrue`);
      if (block.whenFalse) {
        walkBlocks(block.whenFalse, used, `${childPath}.whenFalse`);
      }
    }
  }
}

/**
 * Mutate a JsonGuide so every interactive block, container, and sub-step
 * has a stable id. Author-set ids are preserved. Returns the same guide
 * reference for convenience.
 */
export function synthesizeStepIds(guide: JsonGuide): JsonGuide {
  const used = new Set<string>();
  walkBlocks(guide.blocks, used, '$');
  // Diagnostic — flip to silent once the AI fix flow is verified end-to-end.
  const synthesizedCount = Array.from(used).filter((id) => id.startsWith(SYNTHESIZED_ID_PREFIX)).length;
  console.warn(
    `[AI fix :: synthesizeStepIds] guide="${guide.id}" totalIds=${used.size} synthesized=${synthesizedCount}`
  );
  return guide;
}

/**
 * Convenience wrapper: parses a JSON string, applies synthesis, returns the
 * augmented JSON string. Used at boundaries where the canonical form is the
 * stringified guide (e.g., docs-panel tab content, AI fix orchestrator).
 *
 * Returns the input unchanged if the JSON can't be parsed or doesn't look
 * like a guide — synthesis is a best-effort enhancement, not a validator.
 */
export function synthesizeStepIdsInJson(json: string): string {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as JsonGuide).blocks)) {
      return json;
    }
    synthesizeStepIds(parsed as JsonGuide);
    return JSON.stringify(parsed);
  } catch {
    return json;
  }
}

export { SYNTHESIZED_ID_PREFIX };
