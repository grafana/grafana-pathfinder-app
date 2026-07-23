jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

import { getBackendSrv } from '@grafana/runtime';

import { COMPLETION_RECORDS_TIMEOUT_MS } from '../constants';
import {
  __resetCompletionRecordsClientForTests,
  buildCompletionContext,
  fetchCompletionContextForRecommend,
  fetchMyCompletions,
  type MyCompletionsResponse,
} from './completion-records-client';

const mockGet = jest.fn();

// A full envelope with every field populated — this PINS the grafana-pathfinder-app#1398
// `GET /completion-records/my` contract (pkg/plugin/completion_records.go). If the
// backend renames or drops a field, the mapping assertions below fail.
const HEALTHY_ENVELOPE: MyCompletionsResponse = {
  capability: { available: true },
  userId: 'user:abc123',
  asOf: '2026-07-22T10:00:00Z',
  completions: [
    {
      guideSource: 'grafana-cloud',
      guideId: 'alerting-101',
      guideTitle: 'Alerting 101',
      guideCategory: 'alerting',
      pathId: 'observability-path',
      count: 3,
      latestCompletedAt: '2026-07-20T09:30:00Z',
      latestSource: 'interactive',
      maxCompletionPercent: 100,
    },
  ],
};

let originalOnLine: PropertyDescriptor | undefined;

beforeAll(() => {
  originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
});

afterAll(() => {
  if (originalOnLine) {
    Object.defineProperty(window.navigator, 'onLine', originalOnLine);
  }
});

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetCompletionRecordsClientForTests();
  setOnline(true);
  (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });
});

describe('fetchMyCompletions', () => {
  it('returns the pinned #1398 envelope on a healthy response', async () => {
    mockGet.mockResolvedValueOnce(HEALTHY_ENVELOPE);

    const result = await fetchMyCompletions();

    expect(result).toEqual(HEALTHY_ENVELOPE);
    const calledUrl = mockGet.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('/api/plugins/grafana-pathfinder-app/resources/completion-records/my');
    // showErrorAlert:false so a failing enhancement fetch never raises a global toast.
    expect(mockGet.mock.calls[0]?.[3]).toEqual({ showErrorAlert: false, showSuccessAlert: false });
  });

  it('does not contact the backend when offline', async () => {
    setOnline(false);

    const result = await fetchMyCompletions();

    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns null when the backend rejects (4xx/5xx/network)', async () => {
    mockGet.mockRejectedValueOnce(new Error('HTTP 503'));

    expect(await fetchMyCompletions()).toBeNull();
  });

  it('returns null on a malformed body (missing capability)', async () => {
    mockGet.mockResolvedValueOnce({ completions: [] });

    expect(await fetchMyCompletions()).toBeNull();
  });

  it('returns null when completions is not an array', async () => {
    mockGet.mockResolvedValueOnce({ capability: { available: true }, completions: 'nope' });

    expect(await fetchMyCompletions()).toBeNull();
  });

  it('de-duplicates concurrent callers into one backend request', async () => {
    mockGet.mockResolvedValueOnce(HEALTHY_ENVELOPE);

    const [a, b] = await Promise.all([fetchMyCompletions(), fetchMyCompletions()]);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(a).toEqual(HEALTHY_ENVELOPE);
    expect(b).toEqual(HEALTHY_ENVELOPE);
  });

  it('returns null when the fetch exceeds the latency budget', async () => {
    jest.useFakeTimers();
    try {
      // A request that never settles must not hang the recommend flow.
      mockGet.mockReturnValueOnce(new Promise(() => {}));

      const promise = fetchMyCompletions();
      jest.advanceTimersByTime(COMPLETION_RECORDS_TIMEOUT_MS + 1);

      expect(await promise).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('buildCompletionContext', () => {
  it('maps the envelope into the snake_case recommend sub-contract', () => {
    expect(buildCompletionContext(HEALTHY_ENVELOPE)).toEqual({
      as_of: '2026-07-22T10:00:00Z',
      items: [
        {
          guide_source: 'grafana-cloud',
          guide_id: 'alerting-101',
          guide_category: 'alerting',
          path_id: 'observability-path',
          count: 3,
          latest_completed_at: '2026-07-20T09:30:00Z',
          max_completion_percent: 100,
        },
      ],
    });
  });

  it('collapses empty optional strings to undefined but keeps numeric zero', () => {
    const context = buildCompletionContext({
      capability: { available: true },
      completions: [
        {
          guideSource: 'grafana',
          guideId: 'g1',
          guideTitle: '',
          guideCategory: '',
          pathId: '',
          count: 1,
          latestCompletedAt: '',
          latestSource: '',
          maxCompletionPercent: 0,
        },
      ],
    });

    expect(context).toEqual({
      as_of: undefined,
      items: [
        {
          guide_source: 'grafana',
          guide_id: 'g1',
          guide_category: undefined,
          path_id: undefined,
          count: 1,
          latest_completed_at: undefined,
          max_completion_percent: 0,
        },
      ],
    });
  });

  it('attaches an available-but-empty context (known user, nothing completed)', () => {
    expect(buildCompletionContext({ capability: { available: true }, completions: [], asOf: 'x' })).toEqual({
      as_of: 'x',
      items: [],
    });
  });

  it('skips non-object completion entries without throwing', () => {
    const context = buildCompletionContext({
      capability: { available: true },
      completions: [null, undefined, 'nope', 42, HEALTHY_ENVELOPE.completions[0]] as never,
    });

    expect(context).toEqual({
      as_of: undefined,
      items: [
        {
          guide_source: 'grafana-cloud',
          guide_id: 'alerting-101',
          guide_category: 'alerting',
          path_id: 'observability-path',
          count: 3,
          latest_completed_at: '2026-07-20T09:30:00Z',
          max_completion_percent: 100,
        },
      ],
    });
  });

  it('returns null when the proxy reports the feature unavailable', () => {
    expect(
      buildCompletionContext({
        capability: { available: false, reason: 'backend-unavailable' },
        completions: [],
      })
    ).toBeNull();
  });

  it('returns null on a null response', () => {
    expect(buildCompletionContext(null)).toBeNull();
  });
});

describe('fetchCompletionContextForRecommend', () => {
  it('returns mapped context when the proxy is healthy', async () => {
    mockGet.mockResolvedValueOnce(HEALTHY_ENVELOPE);

    const context = await fetchCompletionContextForRecommend();

    expect(context?.items).toHaveLength(1);
    expect(context?.items[0]?.guide_id).toBe('alerting-101');
  });

  it('returns null when the proxy fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));

    expect(await fetchCompletionContextForRecommend()).toBeNull();
  });

  it('returns null when capability is unavailable', async () => {
    mockGet.mockResolvedValueOnce({
      capability: { available: false, reason: 'identity-unavailable' },
      completions: [],
    });

    expect(await fetchCompletionContextForRecommend()).toBeNull();
  });

  it('resolves without rejecting when the body has non-object completion entries', async () => {
    mockGet.mockResolvedValueOnce({ capability: { available: true }, completions: [null] });

    await expect(fetchCompletionContextForRecommend()).resolves.toEqual({ as_of: undefined, items: [] });
  });
});
