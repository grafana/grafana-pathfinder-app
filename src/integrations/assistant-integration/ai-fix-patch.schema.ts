import { z } from 'zod';

import { JsonInteractiveBlockSchema } from '../../types/json-guide.schema';

// XSS guard for strings flowing into querySelector: HTML/template chars are blocked
// anywhere; URL schemes are blocked only as a prefix, so attribute matches like
// a[href^="javascript:"] pass. 512-char cap bounds querySelector cost.
const DANGEROUS_URL_SCHEMES = ['javascript:', 'data:', 'vbscript:'] as const;
const DANGEROUS_SUBSTRINGS = ['<', '>', '`', '${'] as const;

const SafeSelectorSchema = z
  .string()
  .min(1)
  .max(512, 'Selector exceeds 512-character cap')
  .refine(
    (sel) => {
      const normalized = sel.trim().toLowerCase();
      const startsWithUnsafeScheme = DANGEROUS_URL_SCHEMES.some((scheme) => normalized.startsWith(scheme));
      const containsUnsafeSubstring = DANGEROUS_SUBSTRINGS.some((p) => sel.includes(p));
      return !startsWithUnsafeScheme && !containsUnsafeSubstring;
    },
    { error: 'Selector contains a disallowed substring (HTML, template, or unsafe URL scheme)' }
  );

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
