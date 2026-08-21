import { buildDocumentContext, buildAssistantPrompt, isValidSelection } from './assistant-context.utils';
import type { RawContent } from '../../types/content.types';

function milestonesPayload(contexts: ReturnType<typeof buildDocumentContext>): Array<Record<string, unknown>> {
  const structuredData = (contexts[0] as unknown as { node: { data: { data: Record<string, unknown> } } }).node.data
    .data;
  return structuredData.milestones as Array<Record<string, unknown>>;
}

function journeyContent(milestones: NonNullable<RawContent['metadata']['learningJourney']>['milestones']): RawContent {
  return {
    url: 'https://grafana.com/docs/learning-paths/demo/',
    type: 'learning-journey',
    content: '{}',
    lastFetched: new Date(0).toISOString(),
    metadata: {
      title: 'Demo journey',
      learningJourney: {
        currentMilestone: 1,
        totalMilestones: milestones.length,
        baseUrl: 'https://grafana.com/docs/learning-paths/demo/',
        milestones,
      },
    },
  };
}

describe('buildDocumentContext — milestone estimatedMinutes payload shape', () => {
  it('includes estimatedMinutes on a milestone that has one authored', () => {
    const contexts = buildDocumentContext(
      journeyContent([
        {
          number: 1,
          title: 'Install Prometheus',
          url: 'https://example.com/step-1',
          isActive: true,
          estimatedMinutes: 12,
        },
      ])
    );

    const milestones = milestonesPayload(contexts);
    expect(milestones[0]).toEqual({
      number: 1,
      title: 'Install Prometheus',
      estimatedMinutes: 12,
      isActive: true,
    });
  });

  it('omits the estimatedMinutes key entirely — not present as undefined — when absent', () => {
    const contexts = buildDocumentContext(
      journeyContent([{ number: 1, title: 'Install Prometheus', url: 'https://example.com/step-1', isActive: true }])
    );

    const milestones = milestonesPayload(contexts);
    expect(milestones[0]).toEqual({
      number: 1,
      title: 'Install Prometheus',
      isActive: true,
    });
    expect(Object.hasOwn(milestones[0]!, 'estimatedMinutes')).toBe(false);
  });
});

describe('buildAssistantPrompt', () => {
  it('wraps the selected text into an explanation prompt', () => {
    expect(buildAssistantPrompt('some text')).toContain('some text');
  });
});

describe('isValidSelection', () => {
  it('rejects text shorter than 3 characters', () => {
    expect(isValidSelection('ab')).toBe(false);
  });

  it('accepts text at least 3 characters after trimming', () => {
    expect(isValidSelection('  abc  ')).toBe(true);
  });
});
