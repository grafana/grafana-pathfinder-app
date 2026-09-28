/**
 * Unit tests for the fail-soft write client: POST outcome classification
 * (created / terminal / transient / route-missing) and the platform
 * derivation. getBackendSrv().fetch is mocked to return rxjs observables so
 * lastValueFrom resolves/rejects deterministically.
 */
import { NEVER, of, throwError } from 'rxjs';

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

import {
  postCompletionRecord,
  currentCompletionPlatform,
  WRITE_REQUEST_TIMEOUT_MS,
  IDEMPOTENCY_KEY_FIELD,
  type CompletionWriteBody,
} from './completion-write-client';
import { LEASE_TTL_MS } from './completion-write-storage';
import { logger } from '../lib/logging';

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
    await expect(postCompletionRecord(body(), 'k')).resolves.toEqual({ kind: 'created' });
  });

  it('route-missing on 404', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 404 })));
    await expect(postCompletionRecord(body(), 'k')).resolves.toEqual({ kind: 'route-missing' });
  });

  it('terminal on a non-401/408/429 4xx', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 400 })));
    await expect(postCompletionRecord(body(), 'k')).resolves.toEqual({ kind: 'terminal' });
  });

  it('forbidden on 403 — an absent grant is environmental, never a per-record drop', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 403 })));
    await expect(postCompletionRecord(body(), 'k')).resolves.toEqual({ kind: 'forbidden' });
  });

  it('does not log on 403 — the queue owns the log when the keep-path engages', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    fetchMock.mockReturnValue(throwError(() => ({ status: 403 })));
    await postCompletionRecord(body(), 'k');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('transient on 401 (expired session/token recovers after re-auth)', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 401 })));
    await expect(postCompletionRecord(body(), 'k')).resolves.toEqual({ kind: 'transient' });
  });

  it('transient on 408 (request-timeout ambiguity — safe to replay under the idempotency key)', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 408 })));
    await expect(postCompletionRecord(body(), 'k')).resolves.toEqual({ kind: 'transient' });
  });

  it('transient on 429', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 429 })));
    await expect(postCompletionRecord(body(), 'k')).resolves.toEqual({ kind: 'transient' });
  });

  it('transient on 5xx', async () => {
    fetchMock.mockReturnValue(throwError(() => ({ status: 503 })));
    await expect(postCompletionRecord(body(), 'k')).resolves.toEqual({ kind: 'transient' });
  });

  it('transient on a network error with no status', async () => {
    fetchMock.mockReturnValue(throwError(() => new Error('network down')));
    await expect(postCompletionRecord(body(), 'k')).resolves.toEqual({ kind: 'transient' });
  });

  it('classifies a request that never responds as transient once the real timeout fires', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockReturnValue(NEVER);
      const pending = postCompletionRecord(body(), 'k');
      jest.advanceTimersByTime(WRITE_REQUEST_TIMEOUT_MS + 1);
      await expect(pending).resolves.toEqual({ kind: 'transient' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('idempotency key (end-to-end dedupe backstop)', () => {
  it('always sends the stable id as a required body field so the backend dedupes a retried POST', async () => {
    fetchMock.mockReturnValue(of({ data: { name: 'completion-abc' } }));
    await postCompletionRecord(body(), 'event-123');

    const sent = fetchMock.mock.calls[0]![0];
    expect(sent.data[IDEMPOTENCY_KEY_FIELD]).toBe('event-123');
    // The fact fields are still present alongside the key.
    expect(sent.data).toMatchObject({ guideId: 'g1', platform: 'cloud' });
  });

  it('bounds the request strictly below the drain lease TTL so a POST cannot outlive its lease', () => {
    expect(WRITE_REQUEST_TIMEOUT_MS).toBeLessThan(LEASE_TTL_MS);
    expect(WRITE_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
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
