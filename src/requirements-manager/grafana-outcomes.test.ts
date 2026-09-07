import { getBackendSrv } from '@grafana/runtime';
import { Observable, of, throwError } from 'rxjs';
import { listOutcomeResources, verifyGrafanaOutcome } from './grafana-outcomes';
import type { GuideOutcome } from '../types/outcome.types';

const fetch = jest.fn();
jest.mock('@grafana/runtime', () => ({ getBackendSrv: jest.fn() }));
const dashboard: GuideOutcome = { id: 'dashboard', label: 'Saved dashboard', kind: 'dashboard-saved' };
const datasource: GuideOutcome = {
  id: 'source',
  label: 'Healthy TestData',
  kind: 'datasource-health',
  datasourceType: 'testdata',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getBackendSrv).mockReturnValue({ fetch } as never);
});

it('verifies the selected dashboard UID, not a matching title', async () => {
  fetch.mockReturnValueOnce(of({ data: { dashboard: { uid: 'other' } } }));
  expect(await verifyGrafanaOutcome(dashboard, 'selected', new AbortController().signal)).toMatchObject({
    verdict: 'unsatisfied',
    pass: false,
  });
  fetch.mockReturnValueOnce(of({ data: { dashboard: { uid: 'selected' } } }));
  expect(await verifyGrafanaOutcome(dashboard, 'selected', new AbortController().signal)).toMatchObject({
    verdict: 'satisfied',
    pass: true,
  });
  expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/dashboards/uid/selected' }));
});

it('distinguishes failed health checks from unavailable APIs', async () => {
  for (const [status, verdict] of [
    [400, 'unsatisfied'],
    [403, 'unavailable'],
    [503, 'unavailable'],
  ] as const) {
    fetch.mockReturnValueOnce(throwError(() => ({ status })));
    expect(await verifyGrafanaOutcome(datasource, 'uid', new AbortController().signal)).toMatchObject({
      verdict,
      pass: false,
    });
  }
  fetch.mockReturnValueOnce(of({ data: { status: 'OK' } }));
  expect(await verifyGrafanaOutcome(datasource, 'uid', new AbortController().signal)).toMatchObject({
    verdict: 'satisfied',
    pass: true,
  });
});

it('unsubscribes a pending request when cancelled', async () => {
  const unsubscribe = jest.fn();
  fetch.mockReturnValueOnce(new Observable(() => unsubscribe));
  const controller = new AbortController();
  const result = verifyGrafanaOutcome(dashboard, 'uid', controller.signal);
  controller.abort();
  expect(await result).toMatchObject({ pass: false, verdict: 'unavailable' });
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('lists only the data source type declared by the outcome', async () => {
  fetch.mockReturnValueOnce(
    of({
      data: [
        { uid: 'test', name: 'TestData', type: 'testdata' },
        { uid: 'prom', type: 'prometheus' },
      ],
    })
  );
  expect(await listOutcomeResources(datasource, new AbortController().signal)).toEqual([
    { uid: 'test', label: 'TestData' },
  ]);
});
