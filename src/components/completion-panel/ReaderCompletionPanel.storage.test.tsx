import React from 'react';
import { act, render, screen } from '@testing-library/react';
import type { RawContent } from '../../types/content.types';
import { createLocalStorage, interactiveCompletionStorage, setGlobalStorage } from '../../lib/user-storage';
import { sanitizeContentKey } from '../../global-state/content-key';
import { dispatchProgress } from '../../global-state/progress-events';
import ReaderCompletionPanel from './ReaderCompletionPanel';
import type { CompletionPanelProps } from './CompletionPanel';

jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'test', bootData: { user: { id: 1, orgId: 1 } } },
}));
jest.mock('../../docs-retrieval', () => ({
  journeyProgressFromMilestones: jest.requireActual('../../docs-retrieval/learning-journey-helpers')
    .journeyProgressFromMilestones,
}));
jest.mock('../../lib/analytics', () => ({ reportAppInteraction: jest.fn(), UserInteraction: {} }));
jest.mock('./CompletionPanel', () => ({
  CompletionPanel: ({ moduleContext }: CompletionPanelProps) => (
    <h2>{moduleContext?.pathComplete ? 'Path complete' : 'Milestone complete'}</h2>
  ),
}));

const milestones = [
  { title: 'One', url: 'backend-guide:one', number: 1, isActive: false },
  { title: 'Two', url: 'backend-guide:two', number: 2, isActive: true },
];
const content: RawContent = {
  url: 'backend-guide:two',
  type: 'learning-journey',
  content: '{}',
  lastFetched: '',
  metadata: {
    learningJourney: {
      baseUrl: 'backend-guide:path',
      currentMilestone: 2,
      totalMilestones: 2,
      milestones,
    },
  },
};

beforeEach(() => {
  localStorage.clear();
  setGlobalStorage(createLocalStorage());
});
afterEach(() => {
  jest.restoreAllMocks();
  setGlobalStorage(createLocalStorage());
});

it('reads the final real storage write after it settles and retains path completion across parent copies', async () => {
  await interactiveCompletionStorage.set(sanitizeContentKey(milestones[0]!.url), 100);
  await interactiveCompletionStorage.set(sanitizeContentKey(milestones[1]!.url), 50);
  const reads = jest.spyOn(interactiveCompletionStorage, 'getAll');
  const { rerender } = render(
    <ReaderCompletionPanel content={content} sequence={{ currentMilestone: 2, milestones }} celebrating={false} />
  );
  await act(async () => {});
  expect(screen.getByRole('heading', { name: 'Milestone complete' })).toBeInTheDocument();

  let finishWrite!: () => void;
  const writeGate = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  const local = createLocalStorage();
  setGlobalStorage({
    ...local,
    setItem: async (key, value) => {
      await writeGate;
      await local.setItem(key, value);
    },
  });
  const pendingWrite = interactiveCompletionStorage.set(sanitizeContentKey(milestones[1]!.url), 100);
  await act(async () => {});
  expect(interactiveCompletionStorage.peekAll()[sanitizeContentKey(milestones[1]!.url)]).toBe(50);
  expect(screen.getByRole('heading', { name: 'Milestone complete' })).toBeInTheDocument();
  await act(async () => {
    finishWrite();
    await pendingWrite;
    dispatchProgress({
      kind: 'guide',
      contentKey: sanitizeContentKey(content.url),
      percentage: 100,
      hasProgress: true,
    });
  });
  expect(screen.getByRole('heading', { name: 'Path complete' })).toBeInTheDocument();
  const settledReads = reads.mock.calls.length;

  rerender(
    <ReaderCompletionPanel
      content={{
        ...content,
        metadata: {
          ...content.metadata,
          learningJourney: {
            ...content.metadata.learningJourney!,
            milestones: milestones.map((milestone) => ({ ...milestone })),
          },
        },
      }}
      sequence={{ currentMilestone: 2, milestones: milestones.map((milestone) => ({ ...milestone })) }}
      celebrating={false}
    />
  );
  expect(screen.getByRole('heading', { name: 'Path complete' })).toBeInTheDocument();
  expect(reads).toHaveBeenCalledTimes(settledReads);
});
