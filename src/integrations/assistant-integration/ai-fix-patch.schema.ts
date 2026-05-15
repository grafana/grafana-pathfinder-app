/**
 * AI auto-heal patch wire format.
 *
 * Defines the contract for what the Grafana Assistant is allowed to return
 * when a user clicks the AI-powered "Fix this" button on a failing
 * interactive step (the same affordance offered for deterministic
 * fix-registry recoveries; the sparkle icon distinguishes the AI variant
 * from a deterministic one). Two
 * shapes are accepted:
 *
 * - `selector-patch`: replace the failing step's `reftarget` with a new
 *   CSS selector / data-testid string.
 * - `prepend-step`: insert a fresh interactive step *before* the failing
 *   step, typically to navigate to / set up the missing UI state.
 *
 * Both pass through `JsonInteractiveBlockSchema` (for prepend-step) and a
 * selector deny-list (for selector-patch and the `reftarget` field inside
 * prepend-step's `newStep`). The whole guide is then re-validated against
 * `JsonGuideSchema` after the patch is applied — this file is just the
 * first boundary check.
 *
 * @coupling Runtime patch apply: `src/components/docs-panel/docs-panel.tsx`
 *           `pathfinder-ai-fix-patch` event listener
 */

import { z } from 'zod';

import { JsonInteractiveBlockSchema } from '../../types/json-guide.schema';

/**
 * Reject selectors that contain HTML angle brackets, template-literal
 * interpolation, JS URL schemes, or backticks. These never appear in
 * legitimate CSS selectors or data-testid values, and they're the most
 * common shapes an assistant might "hallucinate" if it confused the patch
 * format with raw HTML or a URL.
 *
 * Also caps length at 512 chars — any selector longer than that is almost
 * certainly malformed, and the cap bounds the cost of `querySelector` on
 * a hostile input.
 */
const DANGEROUS_SELECTOR_PATTERNS = ['<', '>', '`', '${', 'javascript:', 'data:', 'vbscript:'] as const;

const SafeSelectorSchema = z
  .string()
  .min(1)
  .max(512, 'Selector exceeds 512-character cap')
  .refine((sel) => !DANGEROUS_SELECTOR_PATTERNS.some((p) => sel.toLowerCase().includes(p)), {
    error: 'Selector contains a disallowed substring (HTML, template, or unsafe URL scheme)',
  });

/**
 * Selector-patch: assistant believes the failing step's `reftarget` is
 * stale and a different selector would match the intended element.
 */
const SelectorPatchSchema = z.object({
  type: z.literal('selector-patch'),
  /** Stable id of the failing step; runtime ensures this is set before the assistant call. */
  targetStepId: z.string().min(1),
  /** Replacement selector. Subject to `SafeSelectorSchema`. */
  newReftarget: SafeSelectorSchema,
  /** Optional human-readable explanation. Bounded for analytics payload size. */
  rationale: z.string().max(500).optional(),
});

/**
 * Prepend-step: assistant believes the failing step can't succeed in the
 * current UI state and proposes a new step to navigate / set up that
 * state first. The `newStep` reuses the authoritative interactive block
 * schema so the patched guide round-trips through `JsonGuideSchema`.
 */
const PrependStepSchema = z.object({
  type: z.literal('prepend-step'),
  /** Stable id of the failing step. The new step is inserted immediately before it. */
  beforeStepId: z.string().min(1),
  newStep: JsonInteractiveBlockSchema.superRefine((step, ctx) => {
    if (step.reftarget !== undefined) {
      const result = SafeSelectorSchema.safeParse(step.reftarget);
      if (!result.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['reftarget'],
          message: result.error.issues[0]?.message ?? 'Unsafe selector',
        });
      }
    }
  }),
  rationale: z.string().max(500).optional(),
});

/**
 * Substep-selector-patch: the failing step is inside a `multistep` or
 * `guided` container, where individual steps don't carry their own `id`.
 * Address by the container's id + the step's positional index. Otherwise
 * identical in intent to `selector-patch`.
 */
const SubstepSelectorPatchSchema = z.object({
  type: z.literal('substep-selector-patch'),
  /** Stable id of the multistep/guided container block. */
  containerId: z.string().min(1),
  /** 0-based index into the container's `steps` array. */
  subStepIndex: z.number().int().min(0),
  /** Replacement selector. Subject to `SafeSelectorSchema`. */
  newReftarget: SafeSelectorSchema,
  rationale: z.string().max(500).optional(),
});

export const AiFixPatchSchema = z.discriminatedUnion('type', [
  SelectorPatchSchema,
  PrependStepSchema,
  SubstepSelectorPatchSchema,
]);

export type AiFixPatch = z.infer<typeof AiFixPatchSchema>;
export type SelectorPatch = z.infer<typeof SelectorPatchSchema>;
export type PrependStepPatch = z.infer<typeof PrependStepSchema>;
export type SubstepSelectorPatch = z.infer<typeof SubstepSelectorPatchSchema>;
