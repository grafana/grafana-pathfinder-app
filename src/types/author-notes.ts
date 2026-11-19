import type { JsonBlock, JsonGuide, JsonStep } from './json-guide.types';

/**
 * Recursively remove editor-only `authorNote` fields from every block in
 * a guide. Used by the export paths so author notes never ship in
 * published JSON.
 *
 * Walks the standard nested-container fields (`blocks`, `whenTrue`,
 * `whenFalse`, `steps`). Returns a new guide; does not mutate input.
 */
export function stripAuthorNotes(guide: JsonGuide): JsonGuide {
  const stripBlock = (block: JsonBlock): JsonBlock => {
    const cleaned: Record<string, unknown> = { ...(block as unknown as Record<string, unknown>) };
    delete cleaned.authorNote;

    // Recurse into known container fields. Each branch only runs when
    // the field exists on the current variant; we don't add fields.
    if (Array.isArray(cleaned.blocks)) {
      cleaned.blocks = (cleaned.blocks as JsonBlock[]).map(stripBlock);
    }
    if (Array.isArray(cleaned.whenTrue)) {
      cleaned.whenTrue = (cleaned.whenTrue as JsonBlock[]).map(stripBlock);
    }
    if (Array.isArray(cleaned.whenFalse)) {
      cleaned.whenFalse = (cleaned.whenFalse as JsonBlock[]).map(stripBlock);
    }
    if (Array.isArray(cleaned.steps)) {
      // Steps don't currently carry authorNote (they're a sub-shape, not
      // a discriminated block) — passthrough but defensive in case the
      // schema gains it later.
      cleaned.steps = (cleaned.steps as JsonStep[]).map((step) => {
        const cleanedStep = { ...(step as unknown as Record<string, unknown>) };
        delete cleanedStep.authorNote;
        return cleanedStep as unknown as JsonStep;
      });
    }
    return cleaned as unknown as JsonBlock;
  };

  return {
    ...guide,
    blocks: guide.blocks.map(stripBlock),
  };
}
