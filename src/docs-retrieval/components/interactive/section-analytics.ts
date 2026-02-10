/**
 * Analytics reporting for interactive section execution.
 *
 * Pure utility — takes metrics and calls reportAppInteraction.
 * No React hooks, no state, no DOM.
 */

import {
  reportAppInteraction,
  UserInteraction,
  getSourceDocument,
  calculateStepCompletion,
} from '../../../lib/analytics';
import { getDocumentStepPosition } from './step-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SectionAnalyticsParams {
  sectionId: string;
  title: string;
  totalSectionSteps: number;
  completedStepsCount: number;
  startIndex: number;
  wasCanceled: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Report "Do Section" button click analytics after section execution completes.
 * Computes both section-scoped and document-scoped metrics.
 */
export function reportSectionExecution(params: SectionAnalyticsParams): void {
  const { sectionId, title, totalSectionSteps, completedStepsCount, startIndex, wasCanceled } = params;

  const docInfo = getSourceDocument(sectionId);

  // Section-scoped metrics
  const currentSectionStep = completedStepsCount;
  const currentSectionPercentage =
    totalSectionSteps > 0 ? Math.round((completedStepsCount / totalSectionSteps) * 100) : 0;

  // Document-scoped metrics (use last completed step's index for position)
  // If no steps completed, use 0 as the index; otherwise use completedStepsCount - 1
  const lastCompletedStepIndex = completedStepsCount > 0 ? completedStepsCount - 1 : 0;
  const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
    sectionId,
    lastCompletedStepIndex
  );
  const documentCompletionPercentage = calculateStepCompletion(documentStepIndex, documentTotalSteps);

  reportAppInteraction(UserInteraction.DoSectionButtonClick, {
    ...docInfo,
    content_type: 'interactive_guide',
    section_title: title,
    // Section-scoped
    total_steps: totalSectionSteps,
    current_section_step: currentSectionStep,
    current_section_percentage: currentSectionPercentage,
    // Document-scoped
    total_document_steps: documentTotalSteps,
    current_step: documentStepIndex + 1, // 1-indexed for analytics
    ...(documentCompletionPercentage !== undefined && { completion_percentage: documentCompletionPercentage }),
    // Completion status
    canceled: wasCanceled,
    resumed: startIndex > 0, // true if user resumed from a previous position
    interaction_location: 'interactive_section',
  });
}
