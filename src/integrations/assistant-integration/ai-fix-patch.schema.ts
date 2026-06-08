import { z } from 'zod';

import { JsonInteractiveBlockSchema } from '../../types/json-guide.schema';

// Deny-list: reject HTML, template interpolation, and unsafe URL schemes (XSS guard); 512-char cap bounds querySelector cost.
const DANGEROUS_SELECTOR_PATTERNS = ['<', '>', '`', '${', 'javascript:', 'data:', 'vbscript:'] as const;

const SafeSelectorSchema = z
  .string()
  .min(1)
  .max(512, 'Selector exceeds 512-character cap')
  .refine((sel) => !DANGEROUS_SELECTOR_PATTERNS.some((p) => sel.toLowerCase().includes(p)), {
    error: 'Selector contains a disallowed substring (HTML, template, or unsafe URL scheme)',
  });

const SelectorPatchSchema = z.object({
  type: z.literal('selector-patch'),
  targetStepId: z.string().min(1),
  newReftarget: SafeSelectorSchema,
  rationale: z.string().max(500).optional(),
});

const PrependStepSchema = z.object({
  type: z.literal('prepend-step'),
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

const SubstepSelectorPatchSchema = z.object({
  type: z.literal('substep-selector-patch'),
  containerId: z.string().min(1),
  subStepIndex: z.number().int().min(0),
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
