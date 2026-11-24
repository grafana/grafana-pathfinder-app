import { readFileSync } from 'fs';
import { join } from 'path';
import { of, throwError } from 'rxjs';

const fetchMock = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: fetchMock }),
  config: { namespace: 'stacks-1', bootData: { user: { id: 7, orgId: 3 } } },
}));
jest.mock('./completion-write-telemetry', () => ({ reportCompletionWriteDegradation: jest.fn() }));
jest.mock('../lib/proxy-diagnostics', () => ({ reportProxyFailure: jest.fn() }));

import { postCompletionRecord, type CompletionWriteBody } from './completion-write-client';
import { createWriteQueue } from './completion-write-queue';
import { createCompletionWriteStorage } from './completion-write-storage';

interface ResponseRow {
  status: number;
  body: unknown;
  retryAfter: string;
}
const transcript: Record<string, ResponseRow[]> = JSON.parse(
  readFileSync(join(__dirname, '../../scripts/sdk-fidelity/baseline-writes.json'), 'utf8')
);
const body: CompletionWriteBody = {
  guideSource: 'bundled',
  guideId: 'first-dashboard',
  guideTitle: 'First dashboard',
  guideCategory: 'interactive',
  completionPercent: 100,
  source: 'objectives',
  completedAt: '2026-11-01T00:00:00Z',
  platform: 'cloud',
};

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
});

it.each([
  ['forbidden-recovery', 0, 'hold'],
  ['not-found', 0, 'hold'],
  ['invalid-percent', 0, 'drop'],
  ['completed-schema-rejection', 0, 'drop'],
  ['mixed-validation', 0, 'drop'],
  ['other-field-validation', 0, 'drop'],
  ['partial-schema-recovery', 0, 'retry'],
  ['outage-recovery', 0, 'retry'],
  ['throttle', 0, 'retry'],
  ['conflict-exhaustion-recovery', 1, 'retry'],
  ['transport-cancelled-recovery', 0, 'retry'],
  ['transport-deadline-recovery', 0, 'retry'],
  ['transport-network-recovery', 0, 'retry'],
  ['lost-acknowledgement', 1, 'created'],
] as const)('%s response %i drives the real client and queue to %s', async (scenario, index, expected) => {
  const row = transcript[scenario]![index]!;
  fetchMock.mockReturnValue(
    row.status < 400
      ? of({ status: row.status, data: row.body })
      : throwError(() => ({ status: row.status, data: row.body }))
  );
  let clock = 0;
  const storage = createCompletionWriteStorage('user-7:org-3', 'fidelity-tab');
  const created = jest.fn();
  const queue = createWriteQueue({
    now: () => clock,
    send: postCompletionRecord,
    storage,
    nextId: () => 'fidelity-event',
    random: () => 0.5,
    baseBackoffMs: 1000,
    onCreated: created,
  });
  expect(queue.enqueue(body)).toBe(true);
  const result = await queue.processDue();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]![0]).toMatchObject({
    url: '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-1/backend/completion-records',
    data: { idempotencyKey: 'fidelity-event' },
  });
  expect(result.disarmed).toBe(expected === 'hold');
  expect(storage.list()).toHaveLength(expected === 'hold' || expected === 'retry' ? 1 : 0);
  expect(created).toHaveBeenCalledTimes(expected === 'created' ? 1 : 0);
  if (expected === 'retry') {
    expect(queue.snapshot()[0]!.attempts).toBe(1);
    expect(result.nextDelayMs).toBe(1000);
    clock = 1000;
    fetchMock.mockReturnValue(of({ status: 201, data: transcript['outage-recovery']![1]!.body }));
    await queue.processDue();
    expect(storage.list()).toHaveLength(0);
    expect(fetchMock.mock.calls[1]![0].data.idempotencyKey).toBe('fidelity-event');
  } else if (expected === 'hold') {
    clock = 1000;
    await queue.processDue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const resumed = createWriteQueue({ now: () => clock, send: postCompletionRecord, storage });
    fetchMock.mockReturnValue(of({ status: 201, data: transcript['outage-recovery']![1]!.body }));
    await resumed.processDue();
    expect(storage.list()).toHaveLength(0);
  }
});
