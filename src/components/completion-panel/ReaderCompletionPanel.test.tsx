import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { config } from '@grafana/runtime';
import type { RawContent } from '../../types/content.types';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import ReaderCompletionPanel from './ReaderCompletionPanel';
import type { CompletionPanelProps } from './CompletionPanel';
import { dispatchProgress } from '../../global-state/progress-events';

let percentages: number[] = [];
jest.mock('../../docs-retrieval', () => ({
  journeyProgressFromMilestones: () =>
    percentages.length ? percentages.reduce((sum, percent) => sum + percent, 0) / percentages.length : 0,
}));
jest.mock('../../lib/user-storage', () => ({ interactiveCompletionStorage: { getAll: jest.fn(async () => ({})) } }));
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { CompletionPanelViewed: 'viewed', OpenResourceClick: 'clicked' },
  AnalyticsContentType: { LearningJourney: 'learning-journey' },
}));
jest.mock('@grafana/runtime', () => ({ config: { namespace: 'test', bootData: { user: { id: 1, orgId: 1 } } } }));
jest.mock('./CompletionPanel', () => ({
  CompletionPanel: ({ moduleContext, nextModule, onContinue, onView }: CompletionPanelProps) => (
    <div>
      <h2>{moduleContext?.pathComplete ? 'Path complete' : 'Milestone complete'}</h2>
      <button onClick={onView}>Show panel</button>
      {nextModule && <button onClick={onContinue}>{nextModule.title}</button>}
    </div>
  ),
}));

const modules = [
  { title: 'One', url: 'backend-guide:one', number: 1, isActive: false },
  { title: 'Two', url: 'backend-guide:two', number: 2, isActive: true },
];
const content: RawContent = {
  url: 'backend-guide:two',
  type: 'learning-journey',
  content: '{}',
  lastFetched: '',
  metadata: {
    title: 'Private title',
    learningJourney: { baseUrl: 'backend-guide:path', currentMilestone: 2, totalMilestones: 2, milestones: modules },
  },
};
const privateIdentity = { guideId: 'secret-id', guideSource: 'app-platform' as const, sourceConfirmed: true };
beforeEach(() => {
  jest.clearAllMocks();
  percentages = [0, 100];
  config.bootData.user.orgId = 1;
});

it('does not call the last module path completion until every required member completes', async () => {
  const { rerender } = render(
    <ReaderCompletionPanel
      content={content}
      celebrating={false}
      sequence={{ currentMilestone: 2, milestones: modules }}
    />
  );
  await act(async () => {});
  expect(screen.getByRole('heading', { name: 'Milestone complete' })).toBeInTheDocument();
  act(() => {
    percentages = [100, 100];
    dispatchProgress({ kind: 'guide', contentKey: 'backend-guide:two', percentage: 100, hasProgress: true });
  });
  rerender(
    <ReaderCompletionPanel
      content={{
        ...content,
        metadata: {
          ...content.metadata,
          learningJourney: { ...content.metadata.learningJourney!, milestones: [...modules] },
        },
      }}
      celebrating={false}
      sequence={{ currentMilestone: 2, milestones: modules }}
    />
  );
  expect(await screen.findByRole('heading', { name: 'Path complete' })).toBeInTheDocument();
});

it('uses established progress for locked and selected-track sequences', async () => {
  percentages = [100];
  const lockedContent = {
    ...content,
    metadata: {
      ...content.metadata,
      learningJourney: {
        ...content.metadata.learningJourney!,
        milestones: [{ ...modules[0]!, isLocked: true }, modules[1]!],
      },
    },
  };
  const { rerender } = render(
    <ReaderCompletionPanel
      content={lockedContent}
      celebrating={false}
      sequence={{ currentMilestone: 2, milestones: modules }}
    />
  );
  await act(async () => {});
  expect(screen.getByText('Path complete')).toBeInTheDocument();
  rerender(
    <ReaderCompletionPanel
      content={{ ...content, metadata: { title: 'Track member', trackMemberBaseUrl: 'backend-guide:path' } }}
      celebrating={false}
      sequence={{ currentMilestone: 2, milestones: modules }}
    />
  );
  await act(async () => {});
  expect(screen.getByText('Path complete')).toBeInTheDocument();
});

it('reports visible private completion without names, URLs or identifiers and deduplicates it', () => {
  render(
    <ReaderCompletionPanel
      content={{ ...content, url: 'backend-guide:private-view' }}
      completionIdentity={privateIdentity}
      celebrating={false}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show panel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show panel' }));
  expect(reportAppInteraction).toHaveBeenCalledTimes(1);
  expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.CompletionPanelViewed, {
    guide_source: 'app-platform',
    guide_visibility: 'private',
    interaction_location: 'content_completion_panel',
    completion_context: 'guide',
  });
});

it('skips locked modules and retains asynchronous navigation without private click metadata', async () => {
  const onContinue = jest.fn(async () => undefined);
  const sequence = {
    currentMilestone: 1,
    milestones: [modules[0]!, { ...modules[1]!, isLocked: true }, { ...modules[1]!, number: 3, title: 'Three' }],
  };
  render(
    <ReaderCompletionPanel
      content={content}
      completionIdentity={privateIdentity}
      celebrating={false}
      sequence={sequence}
      onContinue={onContinue}
    />
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Three' }));
  });
  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(reportAppInteraction).toHaveBeenCalledWith(
    UserInteraction.OpenResourceClick,
    expect.objectContaining({
      guide_visibility: 'private',
      completion_action: 'next_module',
      interaction_location: 'content_completion_panel',
    })
  );
  const payload = jest.mocked(reportAppInteraction).mock.calls[0]?.[1];
  expect(payload).not.toHaveProperty('content_url');
  expect(payload).not.toHaveProperty('guide_id');
});
