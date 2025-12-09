import { warn } from '../../lib/logger';
import { createAssistantContextItem, type ChatContextItem } from '@grafana/assistant';
import { RawContent } from '../../docs-retrieval/content.types';

/**
 * Build the prompt for the assistant based on highlighted text
 */
export const buildAssistantPrompt = (selectedText: string): string => {
  return `explain based on my context this documentation: ${selectedText}`;
};

/**
 * Build document context from the current content
 */
export const buildDocumentContext = (content: RawContent): ChatContextItem[] => {
  const contexts: ChatContextItem[] = [];

  try {
    // Build structured context with document metadata
    const documentData: Record<string, any> = {
      documentType: content.type,
      documentUrl: content.url,
    };

    // Add metadata if available
    if (content.metadata) {
      if (content.metadata.title) {
        documentData.title = content.metadata.title;
      }

      // Add learning journey specific context
      if (content.type === 'learning-journey' && content.metadata.learningJourney) {
        const journey = content.metadata.learningJourney;

        documentData.currentMilestone = journey.currentMilestone;
        documentData.totalMilestones = journey.totalMilestones;
        documentData.baseUrl = journey.baseUrl;

        // Add summary if available
        if (journey.summary) {
          documentData.journeySummary = journey.summary;
        }

        // Add milestone information
        if (journey.milestones && journey.milestones.length > 0) {
          documentData.milestones = journey.milestones.map((milestone) => ({
            number: milestone.number,
            title: milestone.title,
            duration: milestone.duration,
            isActive: milestone.isActive,
          }));

          // Add current milestone details
          const currentMilestoneData = journey.milestones.find((m) => m.number === journey.currentMilestone);
          if (currentMilestoneData) {
            documentData.currentMilestoneTitle = currentMilestoneData.title;
          }
        }
      }
    }

    // Create structured context item
    const structuredContext = createAssistantContextItem('structured', {
      title: 'Pathfinder Documentation Context',
      data: documentData,
    });

    contexts.push(structuredContext);
  } catch (err) {
    warn('[AssistantIntegration] Failed to build document context:', err);
  }

  return contexts;
};

/**
 * Validate that selected text is suitable for sending to assistant
 */
export const isValidSelection = (text: string): boolean => {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Trim whitespace and check minimum length
  const trimmed = text.trim();
  return trimmed.length >= 3;
};
