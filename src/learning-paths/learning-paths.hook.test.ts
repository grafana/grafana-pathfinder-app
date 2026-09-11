/**
 * Focused tests for App Platform path/journey runtime ingestion
 * (RFC CUSTOM-GUIDE-PACKAGES.md §6.11) — merging into `paths` and
 * `resolveGuideMetadata`'s fallback tier — and for how `resetPath` reports a
 * clear that only partly took. Other hook behavior (badges, streaks) is
 * exercised elsewhere; this file mocks those dependencies down to no-ops.
 */
import { AppEvents } from '@grafana/data';
import { act, renderHook, waitFor } from '@testing-library/react';

let mockNamespace: string | undefined = 'stacks-123';
const mockPublish = jest.fn();
jest.mock('@grafana/runtime', () => ({
  config: {
    get namespace() {
      return mockNamespace;
    },
  },
  getAppEvents: () => ({ publish: mockPublish }),
}));

const mockFetchAppPlatformLearningPaths = jest.fn();
jest.mock('./app-platform-paths', () => ({
  fetchAppPlatformLearningPaths: (namespace: string) => mockFetchAppPlatformLearningPaths(namespace),
}));

const mockFetchPathGuides = jest.fn();
jest.mock('./fetch-path-guides', () => ({
  fetchPathGuides: (pathUrl: string, signal?: AbortSignal) => mockFetchPathGuides(pathUrl, signal),
}));

const BUNDLED_PATHS_DATA = {
  paths: [{ id: 'bundled-path', title: 'Bundled path', description: '', guides: ['bundled-guide'], badgeId: '' }],
  guideMetadata: { 'bundled-guide': { title: 'Bundled guide', estimatedMinutes: 5 } },
};
let mockPathsData: { paths: unknown[]; guideMetadata: Record<string, unknown> } = BUNDLED_PATHS_DATA;
jest.mock('./paths-data', () => ({
  getPathsData: () => mockPathsData,
}));

const EMPTY_PROGRESS = {
  completedGuides: [] as string[],
  earnedBadges: [],
  streakDays: 0,
  lastActivityDate: '',
  pendingCelebrations: [],
};
const mockProgressGet = jest.fn();
const mockPeekAll = jest.fn();

const mockClearAllForContent = jest.fn(async (_contentKey: string): Promise<void> => undefined);
const mockCompletionEmittedClear = jest.fn(async (_dedupeKey: string): Promise<void> => undefined);
jest.mock('../lib/user-storage', () => ({
  learningProgressStorage: {
    get: () => mockProgressGet(),
    dismissCelebration: jest.fn(),
    removeCompletedGuides: jest.fn(),
  },
  interactiveStepStorage: { clearAllForContent: (contentKey: string) => mockClearAllForContent(contentKey) },
  interactiveCompletionStorage: {
    getAll: jest.fn().mockResolvedValue({}),
    peekAll: () => mockPeekAll(),
    clear: jest.fn(),
    clearMany: jest.fn().mockResolvedValue(undefined),
  },
  journeyCompletionStorage: {
    getAll: jest.fn().mockResolvedValue({}),
    clear: jest.fn(),
    clearMany: jest.fn().mockResolvedValue(undefined),
  },
  milestoneCompletionStorage: { clear: jest.fn() },
  guideCompletionMarkStorage: {
    clearMany: jest.fn().mockResolvedValue(undefined),
    clearAllWithPrefix: jest.fn().mockResolvedValue(undefined),
  },
  completionEmittedStorage: {
    isEmitted: jest.fn().mockReturnValue(false),
    markEmitted: jest.fn().mockResolvedValue(undefined),
    clear: (dedupeKey: string) => mockCompletionEmittedClear(dedupeKey),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('./badge-coordinator', () => ({
  markGuideCompleted: jest.fn(),
}));

jest.mock('../global-state/completion-store', () => ({
  evictContentCache: jest.fn(),
}));

import { useLearningPaths } from './learning-paths.hook';

beforeEach(() => {
  jest.clearAllMocks();
  mockNamespace = 'stacks-123';
  mockClearAllForContent.mockImplementation(async () => undefined);
  mockPathsData = BUNDLED_PATHS_DATA;
  mockFetchPathGuides.mockResolvedValue(null);
  mockProgressGet.mockResolvedValue(EMPTY_PROGRESS);
  mockPeekAll.mockReturnValue({});
  mockFetchAppPlatformLearningPaths.mockResolvedValue({ paths: [], guideMetadata: {} });
});

/**
 * A URL-based path: its members are addressed by a docs URL fetched at
 * runtime, and `paths-cloud.json` ships six of them. Their member keys can
 * only be formed from that URL, which is what makes the rollup's join
 * different from the bundled/App Platform id schemes.
 */
const LINUX_PATH_URL = 'https://grafana.com/docs/learning-paths/linux-server-integration/';
const LINUX_MODULES: Record<string, string> = {
  'select-platform': `${LINUX_PATH_URL}select-platform/`,
  'install-alloy': `${LINUX_PATH_URL}install-alloy/`,
  'view-dashboard': `${LINUX_PATH_URL}view-dashboard/`,
};

function useUrlBasedPath(): void {
  mockPathsData = {
    paths: [
      {
        id: 'linux-server-integration',
        title: 'Linux server integration',
        description: '',
        guides: [],
        badgeId: '',
        url: LINUX_PATH_URL,
      },
    ],
    guideMetadata: {},
  };
  mockFetchPathGuides.mockResolvedValue({
    guides: Object.keys(LINUX_MODULES),
    guideMetadata: Object.fromEntries(
      Object.entries(LINUX_MODULES).map(([id, url]) => [id, { title: id, estimatedMinutes: 5, url }])
    ),
  });
}

describe('useLearningPaths — URL-based path rollup (decision 4)', () => {
  async function renderUrlBasedPath() {
    const rendered = renderHook(() => useLearningPaths());
    await waitFor(() => expect(rendered.result.current.paths[0]?.guides).toHaveLength(3));
    return rendered;
  }

  it('scores every module, not only the completed one', async () => {
    // The regression: without each member's launch URL the join can form no
    // key for it, so five of six modules drop out of the mean and one
    // finished module reads 100%.
    useUrlBasedPath();
    mockProgressGet.mockResolvedValue({ ...EMPTY_PROGRESS, completedGuides: ['select-platform'] });

    const { result } = await renderUrlBasedPath();

    expect(result.current.getPathProgress('linux-server-integration')).toBe(33);
    expect(result.current.isPathCompleted('linux-server-integration')).toBe(false);
  });

  it("reads a module's own persisted percentage into the mean", async () => {
    useUrlBasedPath();
    mockProgressGet.mockResolvedValue({ ...EMPTY_PROGRESS, completedGuides: ['select-platform'] });
    mockPeekAll.mockReturnValue({ [LINUX_MODULES['install-alloy']!]: 50 });

    const { result } = await renderUrlBasedPath();

    expect(result.current.getPathProgress('linux-server-integration')).toBe(50);
  });

  it('is 0% while nothing has been completed, however many modules were opened', async () => {
    useUrlBasedPath();

    const { result } = await renderUrlBasedPath();

    expect(result.current.getPathProgress('linux-server-integration')).toBe(0);
    expect(result.current.isPathCompleted('linux-server-integration')).toBe(false);
  });

  it('is complete only once every module is', async () => {
    useUrlBasedPath();
    mockProgressGet.mockResolvedValue({ ...EMPTY_PROGRESS, completedGuides: Object.keys(LINUX_MODULES) });

    const { result } = await renderUrlBasedPath();

    expect(result.current.getPathProgress('linux-server-integration')).toBe(100);
    expect(result.current.isPathCompleted('linux-server-integration')).toBe(true);
  });
});

describe('useLearningPaths — App Platform path ingestion', () => {
  it('merges App Platform paths after bundled paths', async () => {
    mockFetchAppPlatformLearningPaths.mockResolvedValue({
      paths: [
        {
          id: 'fe-alerting-path',
          title: 'Alerting enablement',
          description: 'Alerting enablement',
          guides: ['fe-alerting-01'],
          badgeId: '',
        },
      ],
      guideMetadata: {
        'fe-alerting-01': { title: 'Alerting module 1', estimatedMinutes: 5, url: 'backend-guide:fe-alerting-01' },
      },
    });

    const { result } = renderHook(() => useLearningPaths());

    await waitFor(() => expect(result.current.paths.map((p) => p.id)).toContain('fe-alerting-path'));

    expect(result.current.paths.map((p) => p.id)).toEqual(['bundled-path', 'fe-alerting-path']);
  });

  it('resolves App Platform guide metadata (title + backend-guide: url) via getGuideUrlForPath', async () => {
    mockFetchAppPlatformLearningPaths.mockResolvedValue({
      paths: [
        {
          id: 'fe-alerting-path',
          title: 'Alerting enablement',
          description: '',
          guides: ['fe-alerting-01'],
          badgeId: '',
        },
      ],
      guideMetadata: {
        'fe-alerting-01': { title: 'Alerting module 1', estimatedMinutes: 5, url: 'backend-guide:fe-alerting-01' },
      },
    });

    const { result } = renderHook(() => useLearningPaths());

    await waitFor(() => expect(result.current.paths.map((p) => p.id)).toContain('fe-alerting-path'));

    expect(result.current.getGuideUrlForPath('fe-alerting-01', 'fe-alerting-path')).toBe(
      'backend-guide:fe-alerting-01'
    );
  });

  // The bundled paths.json metadata keeps Object.prototype, and the App Platform
  // tier is null-prototype, so a member id naming a built-in must fall through to
  // the id-titled default rather than resolving to Object.prototype.toString.
  it('titles a member named after an Object.prototype member by its id', async () => {
    mockFetchAppPlatformLearningPaths.mockResolvedValue({
      paths: [
        { id: 'fe-alerting-path', title: 'Alerting enablement', description: '', guides: ['toString'], badgeId: '' },
      ],
      guideMetadata: Object.create(null),
    });

    const { result } = renderHook(() => useLearningPaths());

    await waitFor(() => expect(result.current.paths.map((p) => p.id)).toContain('fe-alerting-path'));

    const [member] = result.current.getPathGuides('fe-alerting-path');
    expect(member!.title).toBe('toString');
    expect(member!.url).toBeUndefined();
  });

  it('does not fetch when no namespace is available', async () => {
    mockNamespace = undefined;

    const { result } = renderHook(() => useLearningPaths());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetchAppPlatformLearningPaths).not.toHaveBeenCalled();
    expect(result.current.paths.map((p) => p.id)).toEqual(['bundled-path']);
  });
});

// A bulk path reset clears several content keys. If it abandoned the sweep on
// the first rejection, the rest of the path would stay reset-but-not-cleared
// with nothing said about it; if it reported per key, the reader would get one
// toast per guide. `resetPath` must finish the sweep, report once, and resolve
// — its two call sites await it inside an un-caught `onClick`.
describe('useLearningPaths — resetPath reports a partial failure once', () => {
  // The keys `resetPath` sweeps for the bundled fixture path (`bundled-path`
  // with member `bundled-guide`): both id schemes, and for `bundled:` both
  // launch shapes.
  const SWEPT_CONTENT_KEYS = [
    'bundled:bundled-path',
    'bundled:bundled-path/content.json',
    'backend-guide:bundled-path',
    'bundled:bundled-guide',
    'bundled:bundled-guide/content.json',
    'backend-guide:bundled-guide',
  ];
  const FAILING_KEY = 'bundled:bundled-path';

  beforeEach(() => {
    mockFetchAppPlatformLearningPaths.mockResolvedValue({ paths: [], guideMetadata: {} });
    mockClearAllForContent.mockImplementation(async (contentKey: string) => {
      if (contentKey === FAILING_KEY) {
        throw new Error('record survived delete');
      }
    });
  });

  it('attempts every content key, publishes one alert error, and still resolves', async () => {
    const { result } = renderHook(() => useLearningPaths());
    await waitFor(() => expect(result.current.paths.map((p) => p.id)).toContain('bundled-path'));

    await act(async () => {
      await expect(result.current.resetPath('bundled-path')).resolves.toBeUndefined();
    });

    const attempted = mockClearAllForContent.mock.calls.map(([key]) => key);
    expect(new Set(attempted)).toEqual(new Set(SWEPT_CONTENT_KEYS));
    expect(attempted).toContain(FAILING_KEY);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith({
      type: AppEvents.alertError.name,
      payload: [
        'Reset incomplete',
        "Some of this path's progress could not be cleared. Reload the page and try again.",
      ],
    });
  });

  it('says nothing when every content key clears', async () => {
    mockClearAllForContent.mockImplementation(async () => undefined);

    const { result } = renderHook(() => useLearningPaths());
    await waitFor(() => expect(result.current.paths.map((p) => p.id)).toContain('bundled-path'));

    await act(async () => {
      await result.current.resetPath('bundled-path');
    });

    expect(mockClearAllForContent).toHaveBeenCalledTimes(SWEPT_CONTENT_KEYS.length);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // Reset-then-re-mark defect: a member re-completed after a path reset must
  // not dedupe against the completion this reset just erased.
  it('lifts the completion-recorder dedupe guard for the path and every member', async () => {
    mockClearAllForContent.mockImplementation(async () => undefined);

    const { result } = renderHook(() => useLearningPaths());
    await waitFor(() => expect(result.current.paths.map((p) => p.id)).toContain('bundled-path'));

    await act(async () => {
      await result.current.resetPath('bundled-path');
    });

    const invalidatedKeys = mockCompletionEmittedClear.mock.calls.map(([key]) => key);
    expect(new Set(invalidatedKeys)).toEqual(
      new Set([
        'guide:bundled:bundled-path',
        'journey:bundled:bundled-path',
        'guide:app-platform:bundled-path',
        'journey:app-platform:bundled-path',
        'guide:interactive-tutorials:bundled-path',
        'journey:interactive-tutorials:bundled-path',
        'guide:bundled:bundled-guide',
        'journey:bundled:bundled-guide',
        'guide:app-platform:bundled-guide',
        'journey:app-platform:bundled-guide',
        'guide:interactive-tutorials:bundled-guide',
        'journey:interactive-tutorials:bundled-guide',
      ])
    );
  });
});
