import { z } from 'zod';
import type { OutcomeEvidence, GuideOutcome } from './outcome.types';

export const OutcomeScopeSchema = z.object({
  userId: z.string().min(1).max(128),
  orgId: z.string().min(1).max(128),
  guideId: z.string().min(1).max(2048),
  guideRevision: z.string().min(1).max(128),
});

export const OutcomeEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  scope: OutcomeScopeSchema,
  outcomeId: z.string().min(1).max(128),
  resourceUid: z.string().min(1).max(128),
  verifiedAt: z.number().positive(),
}) satisfies z.ZodType<OutcomeEvidence>;

export const GuideOutcomeSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(160),
  kind: z.enum(['datasource-health', 'dashboard-saved']),
  datasourceType: z.string().min(1).max(128).optional(),
}) satisfies z.ZodType<GuideOutcome>;

export const GuideOutcomesSchema = z
  .array(GuideOutcomeSchema)
  .min(1)
  .max(8)
  .refine(
    (outcomes) => new Set(outcomes.map((outcome) => outcome.id)).size === outcomes.length,
    'Outcome ids must be unique'
  );
