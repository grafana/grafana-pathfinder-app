import { z } from 'zod';
import type { OutcomeEvidence } from './outcome.types';

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
