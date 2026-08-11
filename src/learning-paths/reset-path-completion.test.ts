/**
 * `resetPath` against the REAL storage modules (#1560).
 *
 * `learning-paths.hook.test.ts` mocks `../lib/user-storage` wholesale, so it
 * cannot see which storage keys a reset actually touches — and the bug was
 * exactly that: an App Platform path (no `url`, so it takes the second branch)
 * had its members cleared but never its own cover key, leaving the
 * "all milestones done" checklist behind for the next completion to re-cross.
 */
import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'stacks-123' },
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
}));

const mockFetchAppPlatformLearningPaths = jest.fn();
jest.mock('./app-platform-paths', () => ({
  fetchAppPlatformLearningPaths: (namespace: string) => mockFetchAppPlatformLearningPaths(namespace),
}));

jest.mock('./fetch-path-guides', () => ({
  fetchPathGuides: jest.fn().mockResolvedValue(null),
}));

jest.mock('./paths-data', () => ({
  getPathsData: () => ({ paths: [], guideMetadata: {} }),
}));

jest.mock('../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: new Proxy({}, { get: (_t, p) => String(p) }),
}));

import { __resetRecorderForTests, onCompletionRecorded, type CompletionFact } from '../completion-records';
import { markMilestoneDone } from '../docs-retrieval';
import { journeyCompletionStorage, milestoneCompletionStorage } from '../lib/user-storage';
import { useLearningPaths } from './learning-paths.hook';

const PATH_ID = 'fe-alerting-path';
const PATH_KEY = `backend-guide:${PATH_ID}`;
const GUIDES = ['fe-alerting-01', 'fe-alerting-02', 'fe-alerting-03'];

async function seedCompletedCourse(): Promise<void> {
  for (const guideId of GUIDES) {
    await milestoneCompletionStorage.markCompleted(PATH_KEY, guideId);
  }
  await journeyCompletionStorage.set(PATH_KEY, 100);
}

async function renderAndResetPath(): Promise<void> {
  const { result, unmount } = renderHook(() => useLearningPaths());
  await waitFor(() => expect(result.current.paths.map((p) => p.id)).toContain(PATH_ID));
  await act(async () => {
    await result.current.resetPath(PATH_ID);
  });
  unmount();
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  __resetRecorderForTests();
  mockFetchAppPlatformLearningPaths.mockResolvedValue({
    paths: [
      {
        id: PATH_ID,
        title: 'Alerting enablement',
        description: '',
        guides: GUIDES,
        badgeId: '',
        manifest: { id: PATH_ID, type: 'path', repository: 'app-platform', milestones: GUIDES },
      },
    ],
    guideMetadata: Object.fromEntries(
      GUIDES.map((id) => [id, { title: id, estimatedMinutes: 5, url: `backend-guide:${id}` }])
    ),
  });
});

describe('resetPath — App Platform path (no url)', () => {
  it('clears the milestone checklist stored under the path cover key', async () => {
    await seedCompletedCourse();

    await renderAndResetPath();

    await expect(milestoneCompletionStorage.getCompleted(PATH_KEY)).resolves.toEqual(new Set());
  });

  it('clears the journey completion percentage stored under the path cover key', async () => {
    await seedCompletedCourse();

    await renderAndResetPath();

    await expect(journeyCompletionStorage.get(PATH_KEY)).resolves.toBe(0);
  });

  it('also clears the bundled cover key, for a bundled path that carries no url', async () => {
    const bundledKey = `bundled:${PATH_ID}`;
    await milestoneCompletionStorage.markCompleted(bundledKey, GUIDES[0]!);
    await journeyCompletionStorage.set(bundledKey, 100);

    await renderAndResetPath();

    await expect(milestoneCompletionStorage.getCompleted(bundledKey)).resolves.toEqual(new Set());
    await expect(journeyCompletionStorage.get(bundledKey)).resolves.toBe(0);
  });

  it('leaves one completed guide short of the whole-course threshold after a reset', async () => {
    await seedCompletedCourse();

    await renderAndResetPath();

    __resetRecorderForTests();
    const facts: CompletionFact[] = [];
    const unsubscribe = onCompletionRecorded((fact) => facts.push(fact));

    await markMilestoneDone(PATH_KEY, GUIDES[0]!, GUIDES.length, {
      packageManifest: { id: PATH_ID, repository: 'app-platform' },
    });
    unsubscribe();

    await expect(milestoneCompletionStorage.getCompleted(PATH_KEY)).resolves.toEqual(new Set([GUIDES[0]]));
    expect(facts.filter((fact) => fact.kind === 'journey')).toEqual([]);
  });
});
