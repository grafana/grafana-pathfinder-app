/**
 * Write → read round-trip for App Platform path progress.
 *
 * The completion write (`markMilestoneDone`, docs-retrieval) and the progress
 * read (`getPathProgress` → the module-private `calculatePathProgress`) agree
 * only if both key on the bare package id. Every other test on either side
 * mocks the other away, so the two could drift apart — a member recorded under
 * `backend-guide:fe-alerting-01` would leave My Learning stuck at 0%.
 *
 * Storage is real here and backed by localStorage; only `@grafana/runtime` is
 * mocked, so the catalogue fetch, path synthesis, badge coordinator and
 * progress storage all run for real.
 */
import { renderHook, waitFor } from '@testing-library/react';

const mockGet = jest.fn();

jest.mock('@grafana/runtime', () => ({
  config: {
    namespace: 'stacks-123',
    featureToggles: { 'aggregation.pathfinderbackend-ext-grafana-app.enabled': true },
  },
  getBackendSrv: () => ({ get: mockGet }),
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
  reportInteraction: jest.fn(),
}));

import { markMilestoneDone, getMilestoneSlug } from '../docs-retrieval/learning-journey-helpers';
import { invalidateCustomGuideRepositoryCache } from '../lib/custom-guide-repository-client';
import { StorageKeys } from '../lib/storage-keys';
import { useLearningPaths } from './learning-paths.hook';

const EMPTY_PROGRESS = {
  completedGuides: [],
  earnedBadges: [],
  streakDays: 0,
  lastActivityDate: '',
  pendingCelebrations: [],
};

const PATH_ID = 'fe-alerting-path';
const MEMBERS = ['fe-alerting-01', 'fe-alerting-02'];
const PATH_LAUNCH_URL = `backend-guide:${PATH_ID}`;

const catalogue = {
  capability: { available: true },
  guides: [
    {
      id: PATH_ID,
      title: 'Alerting enablement',
      status: 'published',
      manifest: { type: 'path', description: 'Two private guides', milestones: MEMBERS },
    },
    { id: MEMBERS[0], title: 'Alerting module 1', status: 'published', manifest: { type: 'guide' } },
    { id: MEMBERS[1], title: 'Alerting module 2', status: 'published', manifest: { type: 'guide' } },
  ],
};

async function renderPaths() {
  const { result } = renderHook(() => useLearningPaths());
  await waitFor(() => {
    expect(result.current.paths.some((p) => p.id === PATH_ID)).toBe(true);
  });
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  // Seed an explicit empty record: on a storage miss learningProgressStorage.get
  // hands back a shared module-level default that the badge coordinator mutates
  // in place, so completions would leak between cases.
  localStorage.setItem(StorageKeys.LEARNING_PROGRESS, JSON.stringify(EMPTY_PROGRESS));
  invalidateCustomGuideRepositoryCache();
  mockGet.mockResolvedValue(catalogue);
});

describe('App Platform path progress — completion write → getPathProgress read', () => {
  it('reports 0% before anything is completed', async () => {
    const result = await renderPaths();
    expect(result.current.getPathProgress(PATH_ID)).toBe(0);
  });

  it('reports 100% after both members are completed through the real write path', async () => {
    for (const member of MEMBERS) {
      await markMilestoneDone(PATH_LAUNCH_URL, getMilestoneSlug(`backend-guide:${member}`));
    }

    const result = await renderPaths();

    await waitFor(() => {
      expect(result.current.getPathProgress(PATH_ID)).toBe(100);
    });
    expect(result.current.isPathCompleted(PATH_ID)).toBe(true);
  });

  it('reports 50% when only one of the two members is completed', async () => {
    await markMilestoneDone(PATH_LAUNCH_URL, getMilestoneSlug(`backend-guide:${MEMBERS[0]}`));

    const result = await renderPaths();

    await waitFor(() => {
      expect(result.current.getPathProgress(PATH_ID)).toBe(50);
    });
    expect(result.current.isPathCompleted(PATH_ID)).toBe(false);
  });

  it('marks the completed member — and only that member — through getPathGuides', async () => {
    await markMilestoneDone(PATH_LAUNCH_URL, getMilestoneSlug(`backend-guide:${MEMBERS[1]}`));

    const result = await renderPaths();

    await waitFor(() => {
      expect(result.current.getPathGuides(PATH_ID).map((g) => g.completed)).toEqual([false, true]);
    });
  });
});
