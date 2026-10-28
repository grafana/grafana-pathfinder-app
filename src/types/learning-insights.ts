import type { z } from 'zod';
import type {
  LearningInsightsPersonWireSchema,
  LearningInsightsCompletionWireSchema,
  LearningInsightsAssignmentWireSchema,
  LearningInsightsResponseWireSchema,
} from './backend-api.schema';

export { LearningInsightsResponseWireSchema } from './backend-api.schema';
export type LearningInsightsPerson = z.infer<typeof LearningInsightsPersonWireSchema>;
export type LearningInsightsCompletion = z.infer<typeof LearningInsightsCompletionWireSchema>;
export type LearningInsightsAssignment = z.infer<typeof LearningInsightsAssignmentWireSchema>;
export type LearningInsightsResponse = z.infer<typeof LearningInsightsResponseWireSchema>;
