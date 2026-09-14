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

const mockBundledPaths: { current: unknown[] } = { current: [] };
jest.mock('./paths-data', () => ({
  getPathsData: () => ({ paths: mockBundledPaths.current, guideMetadata: {} }),
}));

const mockEvictContentCache = jest.fn();
jest.mock('../global-state/completion-store', () => {
  const actual = jest.requireActual('../global-state/completion-store');
  return {
    ...actual,
    evictContentCache: (contentKey: string) => {
      mockEvictContentCache(contentKey);
      return actual.evictContentCache(contentKey);
    },
  };
});

jest.mock('../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: new Proxy({}, { get: (_t, p) => String(p) }),
}));

import { __resetRecorderForTests, onCompletionRecorded, type CompletionFact } from '../completion-records';
import { markMilestoneDone } from '../docs-retrieval';
import {
  guideCompletionMarkStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
  journeyCompletionStorage,
  milestoneCompletionStorage,
} from '../lib/user-storage';
import { pathMemberContentKeys } from '../global-state/path-member-join';
import { useLearningPaths } from './learning-paths.hook';

const PATH_ID = 'fe-alerting-path';
const PATH_KEY = `backend-guide:${PATH_ID}`;
const BUNDLED_PATH_KEY = `bundled:${PATH_ID}`;
const GUIDES = ['fe-alerting-01', 'fe-alerting-02', 'fe-alerting-03'];
const MEMBER_KEYS = GUIDES.flatMap((id) => [`bundled:${id}`, `backend-guide:${id}`]);
const SENTINEL_KEY = 'backend-guide:unrelated-guide';

async function seedCompletedCourse(): Promise<void> {
  for (const guideId of GUIDES) {
    await milestoneCompletionStorage.markCompleted(PATH_KEY, guideId);
  }
  await journeyCompletionStorage.set(PATH_KEY, 100);
}

async function renderAndResetPath(pathId: string = PATH_ID): Promise<void> {
  const { result, unmount } = renderHook(() => useLearningPaths());
  await waitFor(() => expect(result.current.paths.map((p) => p.id)).toContain(pathId));
  await act(async () => {
    await result.current.resetPath(pathId);
  });
  unmount();
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  __resetRecorderForTests();
  mockBundledPaths.current = [];
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
    const unsubscribe = onCompletionRecorded((fact) => {
      facts.push(fact);
      return true;
    });

    await markMilestoneDone(PATH_KEY, GUIDES[0]!, GUIDES, {
      packageManifest: { id: PATH_ID, repository: 'app-platform' },
    });
    unsubscribe();

    await expect(milestoneCompletionStorage.getCompleted(PATH_KEY)).resolves.toEqual(new Set([GUIDES[0]]));
    expect(facts.filter((fact) => fact.kind === 'journey')).toEqual([]);
  });

  it('clears every member key in one pass, without restoring siblings, and spares unrelated content', async () => {
    for (const key of [...MEMBER_KEYS, SENTINEL_KEY]) {
      await journeyCompletionStorage.set(key, 100);
      await interactiveCompletionStorage.set(key, 100);
    }

    await renderAndResetPath();

    const [journeys, interactives] = await Promise.all([
      journeyCompletionStorage.getAll(),
      interactiveCompletionStorage.getAll(),
    ]);
    expect(MEMBER_KEYS.filter((key) => key in journeys)).toEqual([]);
    expect(MEMBER_KEYS.filter((key) => key in interactives)).toEqual([]);
    expect(journeys[SENTINEL_KEY]).toBe(100);
    expect(interactives[SENTINEL_KEY]).toBe(100);
  });

  it('clears the package-launch shape of a member, which the join also reads', async () => {
    // A bundled member opened from the context panel persists under
    // `bundled:<id>/content.json`. Sparing it would leave the member reading
    // its pre-reset percentage back through `pathMemberContentKeys`.
    const packageKeys = GUIDES.map((id) => `bundled:${id}/content.json`);
    for (const key of packageKeys) {
      await interactiveCompletionStorage.set(key, 100);
      await interactiveStepStorage.setCompleted(key, 'section-one', new Set(['step-1']));
    }

    await renderAndResetPath();

    const interactives = await interactiveCompletionStorage.getAll();
    expect(packageKeys.filter((key) => key in interactives)).toEqual([]);
    for (const key of packageKeys) {
      await expect(interactiveStepStorage.getCompleted(key, 'section-one')).resolves.toEqual(new Set());
    }
  });

  it('clears the raw key space and spares the unsafe sanitized one when they differ', async () => {
    // `journeyCompletionStorage` and `milestoneCompletionStorage` are keyed by
    // the raw launch URL; the interactive namespaces by its sanitized content
    // key. A CR-authored member id long enough to cross MAX_KEY_LENGTH (200)
    // makes the two lists diverge, which every other id here does not.
    const longId = `fe-${'x'.repeat(230)}`;
    const rawKey = `bundled:${longId}`;
    const truncatedKey = rawKey.slice(0, 200);
    expect(truncatedKey).not.toBe(rawKey);

    mockFetchAppPlatformLearningPaths.mockResolvedValue({
      paths: [
        {
          id: PATH_ID,
          title: 'Alerting enablement',
          description: '',
          guides: [longId],
          badgeId: '',
          manifest: { id: PATH_ID, type: 'path', repository: 'app-platform', milestones: [longId] },
        },
      ],
      guideMetadata: { [longId]: { title: longId, estimatedMinutes: 5 } },
    });

    await journeyCompletionStorage.set(rawKey, 100);
    await interactiveCompletionStorage.set(truncatedKey, 100);

    await renderAndResetPath();

    const [journeys, interactives] = await Promise.all([
      journeyCompletionStorage.getAll(),
      interactiveCompletionStorage.getAll(),
    ]);

    // Raw-keyed namespace: cleared, because the raw key names only this
    // member. Feeding it sanitized keys instead would spare this record.
    expect(rawKey in journeys).toBe(false);

    // Sanitized namespace: deliberately SPARED. The truncated key is not
    // uniquely this member's — another id agreeing on its first 192 characters
    // sanitizes to the same string — so the join refuses to form it and the
    // reset must not delete it. The containment invariant still holds because
    // the join refuses the same key, so nothing stale is readable back.
    expect(truncatedKey in interactives).toBe(true);
    expect(pathMemberContentKeys({ id: longId })).toEqual([]);
  });

  it('clears every member guide completion mark and spares unrelated content', async () => {
    for (const key of [...MEMBER_KEYS, SENTINEL_KEY]) {
      await guideCompletionMarkStorage.set(key, true);
    }

    await renderAndResetPath();

    for (const key of MEMBER_KEYS) {
      await expect(guideCompletionMarkStorage.get(key)).resolves.toBeNull();
    }
    await expect(guideCompletionMarkStorage.get(SENTINEL_KEY)).resolves.toBe(true);
  });

  it('clears interactive progress recorded against the path cover itself', async () => {
    for (const pathKey of [PATH_KEY, BUNDLED_PATH_KEY]) {
      await interactiveStepStorage.setCompleted(pathKey, 'cover-section', new Set(['step-1', 'step-2']));
      await interactiveCompletionStorage.set(pathKey, 100);
      interactiveStepStorage.countAllCompleted(pathKey);
    }

    await renderAndResetPath();

    for (const pathKey of [PATH_KEY, BUNDLED_PATH_KEY]) {
      await expect(interactiveStepStorage.getCompleted(pathKey, 'cover-section')).resolves.toEqual(new Set());
      await expect(interactiveCompletionStorage.get(pathKey)).resolves.toBe(0);
      expect(interactiveStepStorage.countAllCompleted(pathKey)).toBe(0);
      expect(mockEvictContentCache).toHaveBeenCalledWith(pathKey);
    }
  });
});

describe('resetPath — URL-based journey path', () => {
  const URL_PATH_ID = 'alerting-journey';
  const PATH_URL = 'https://grafana.com/docs/learning-journeys/alerting/';
  const MILESTONE_SLUGS = ['collect-logs', 'define-rules', 'route-alerts'];
  const MILESTONE_URLS = MILESTONE_SLUGS.map((slug) => `${PATH_URL}${slug}/`);
  const OTHER_JOURNEY_KEY = 'https://grafana.com/docs/learning-journeys/dashboards/';

  beforeEach(() => {
    mockBundledPaths.current = [
      {
        id: URL_PATH_ID,
        title: 'Alerting journey',
        description: '',
        guides: MILESTONE_SLUGS,
        badgeId: '',
        url: PATH_URL,
      },
    ];
  });

  it('clears every milestone key in one pass, without restoring siblings, and spares other journeys', async () => {
    for (const url of [...MILESTONE_URLS, OTHER_JOURNEY_KEY]) {
      await interactiveCompletionStorage.set(url, 100);
      await journeyCompletionStorage.set(url, 100);
    }
    await journeyCompletionStorage.set(PATH_URL, 100);

    await renderAndResetPath(URL_PATH_ID);

    const [journeys, interactives] = await Promise.all([
      journeyCompletionStorage.getAll(),
      interactiveCompletionStorage.getAll(),
    ]);
    expect([PATH_URL, ...MILESTONE_URLS].filter((url) => url in journeys)).toEqual([]);
    expect(MILESTONE_URLS.filter((url) => url in interactives)).toEqual([]);
    expect(journeys[OTHER_JOURNEY_KEY]).toBe(100);
    expect(interactives[OTHER_JOURNEY_KEY]).toBe(100);
  });

  it('clears a milestone mark recovered by prefix, even with no interactive progress to find it by', async () => {
    for (const url of [...MILESTONE_URLS, OTHER_JOURNEY_KEY]) {
      await guideCompletionMarkStorage.set(url, true);
    }

    await renderAndResetPath(URL_PATH_ID);

    for (const url of MILESTONE_URLS) {
      await expect(guideCompletionMarkStorage.get(url)).resolves.toBeNull();
    }
    await expect(guideCompletionMarkStorage.get(OTHER_JOURNEY_KEY)).resolves.toBe(true);
  });
});
