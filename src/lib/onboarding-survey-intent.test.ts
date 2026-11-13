import { config, getBackendSrv } from '@grafana/runtime';
import { of, throwError, Subject } from 'rxjs';
import { readSavedSurveyIntent } from './onboarding-survey-intent';

jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'stack/a', bootData: { user: { id: 1, uid: 'user/b', isSignedIn: true } } },
  getBackendSrv: jest.fn(),
}));
const fetch = jest.fn();
const read = () => readSavedSurveyIntent(new AbortController().signal);
beforeEach(() => {
  jest.clearAllMocks();
  config.bootData.user.isSignedIn = true;
  config.bootData.user.uid = 'user/b';
  (getBackendSrv as jest.Mock).mockReturnValue({ fetch });
});
it.each([
  [{ targetSystem: 'exploring', usage: 'evaluating' }, true],
  [{ targetSystem: 'exploring', experience: 'new' }, true],
  [{ targetSystem: 'app' }, false],
])('reads only the supported target field %j', async (survey, exploring) => {
  fetch.mockReturnValue(of({ data: { spec: { data: { 'onboarding-flow.survey-intent': JSON.stringify(survey) } } } }));
  expect(await read()).toEqual({ status: 'ready', exploring });
  expect(fetch).toHaveBeenCalledWith({
    method: 'GET',
    url: '/apis/userstorage.grafana.app/v0alpha1/namespaces/stack%2Fa/user-storage/grafana-setupguide-app%3Auser%2Fb',
    showErrorAlert: false,
  });
});
it('does not request signed-out storage', async () => {
  config.bootData.user.isSignedIn = false;
  expect(await read()).toEqual({ status: 'unavailable', exploring: false });
  expect(fetch).not.toHaveBeenCalled();
});
it('supports legacy numeric user IDs', async () => {
  config.bootData.user.uid = '';
  fetch.mockReturnValue(of({ data: { spec: { data: {} } } }));
  await read();
  expect(fetch.mock.calls[0][0].url).toContain('grafana-setupguide-app%3A1');
});
it.each([
  null,
  {},
  { spec: {} },
  { spec: { data: { 'onboarding-flow.survey-intent': 'invalid' } } },
  { spec: { data: { 'onboarding-flow.survey-intent': JSON.stringify({ targetSystem: 'unknown' }) } } },
  { spec: { data: { 'onboarding-flow.survey-intent': 'x'.repeat(4097) } } },
])('fails closed for malformed response %j', async (data) => {
  fetch.mockReturnValue(of({ data }));
  expect(await read()).toEqual({ status: 'unavailable', exploring: false });
});
it.each([403, 500])('fails closed on HTTP %i', async (status) => {
  fetch.mockReturnValue(throwError(() => ({ status })));
  expect(await read()).toEqual({ status: 'unavailable', exploring: false });
});
it('treats missing resource as not yet saved', async () => {
  fetch.mockReturnValue(throwError(() => ({ status: 404 })));
  expect(await read()).toEqual({ status: 'ready', exploring: false });
});
it('cancels an in-flight request', async () => {
  const response = new Subject();
  fetch.mockReturnValue(response);
  const controller = new AbortController();
  const pending = readSavedSurveyIntent(controller.signal);
  controller.abort();
  expect(await pending).toEqual({ status: 'unavailable', exploring: false });
  expect(response.observed).toBe(false);
});
it('times out a stalled request without logging private data', async () => {
  jest.useFakeTimers();
  const response = new Subject();
  fetch.mockReturnValue(response);
  const pending = read();
  jest.advanceTimersByTime(5000);
  expect(await pending).toEqual({ status: 'unavailable', exploring: false });
  expect(response.observed).toBe(false);
  jest.useRealTimers();
});
