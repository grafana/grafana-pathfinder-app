/**
 * Unit tests for the fail-soft write client: POST outcome classification
 * (created / terminal / transient / route-missing), Retry-After extraction,
 * and the platform derivation. getBackendSrv().fetch is mocked to
 * return rxjs observables so lastValueFrom resolves/rejects deterministically.
 */
import { of, throwError } from 'rxjs';

const fetchMock = jest.fn();
let versionString = 'Grafana Cloud v11.0.0';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: fetchMock }),
  config: {
    get bootData() {
      return { settings: { buildInfo: { versionString } } };
    },
  },
}));

import { postCompletionRecord, currentCompletionPlatform, type CompletionWriteBody } from './completion-write-client';

function body(): CompletionWriteBody {
  return {
    guideSource: 'bundled',
    guideId: 'g1',
    guideTitle: 'G1',
    guideCategory: 'interactive',
    completionPercent: 100,
    source: 'objectives',
    completedAt: '2026-07-20T00:00:00.000Z',
    platform: 'cloud',
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  versionString = 'Grafana Cloud v11.0.0';
});

describe('postCompletionRecord — outcome classification', () => {
  it('created on 2xx', async () => {
    fetchMock.mockReturnValue(of({ data: { name: 'completion-abc' } }));
    await expect(postCompletionRecord(body())).resolves.toEqual({ kind: 'created' });
  });

  it('route-missing on 404', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 404 })));
    await expect(postCompletionRecord(body())).resolves.toEqual({ kind: 'route-missing' });
  });

  it('terminal on a non-429 4xx', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 400 })));
    await expect(postCompletionRecord(body())).resolves.toEqual({ kind: 'terminal' });
  });

  it('terminal on 403 (identity-scoped)', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 403 })));
    await expect(postCompletionRecord(body())).resolves.toEqual({ kind: 'terminal' });
  });

  it('transient on 429, echoing Retry-After as ms', async () => {
    fetchMock.mockReturnValue(
      throwError(() => ({ status: 429, headers: { get: (n: string) => (n === 'Retry-After' ? '15' : null) } }))
    );
    await expect(postCompletionRecord(body())).resolves.toEqual({ kind: 'transient', retryAfterMs: 15000 });
  });

  it('transient on 5xx', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 503 })));
    await expect(postCompletionRecord(body())).resolves.toEqual({ kind: 'transient', retryAfterMs: undefined });
  });

  it('transient on a network error with no status', async () => {
    fetchMock.mockReturnValue(throwError(() => new Error('network down')));
    await expect(postCompletionRecord(body())).resolves.toEqual({ kind: 'transient', retryAfterMs: undefined });
  });
});

describe('currentCompletionPlatform', () => {
  it('reports cloud for a Grafana Cloud build', () => {
    versionString = 'Grafana Cloud v11.0.0';
    expect(currentCompletionPlatform()).toBe('cloud');
  });

  it('reports oss otherwise', () => {
    versionString = 'Grafana v11.0.0';
    expect(currentCompletionPlatform()).toBe('oss');
  });
});
