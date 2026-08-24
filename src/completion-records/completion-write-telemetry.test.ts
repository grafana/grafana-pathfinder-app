import { reportCompletionWriteDegradation, type CompletionWriteDegradation } from './completion-write-telemetry';
import { pushFaroEvent } from '../lib/telemetry/faro-adapter';

// Only the vendor adapter is mocked, so the real emitter body and the real
// facade both run: the emitter resolves the facade through a lazy require
// inside a bare catch, and a broken path or renamed export would otherwise go
// dark silently. Nothing shorter than an end-to-end assertion catches that.
jest.mock('../lib/telemetry/faro-adapter', () => ({
  pushFaroEvent: jest.fn(),
  pushFaroMeasurement: jest.fn(),
  withFaroUserAction: jest.fn((_name: string, _attrs: unknown, work: () => unknown) => work()),
  USER_ACTION_TIMEOUT_MEDIUM_MS: 60_000,
}));

const mockPushFaroEvent = pushFaroEvent as jest.Mock;

const REASONS: CompletionWriteDegradation[] = [
  'route-missing',
  'forbidden-hold',
  'terminal-drop',
  'eviction',
  'expired-drop',
  'enqueue-failed',
  'drain-failed',
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reportCompletionWriteDegradation', () => {
  it.each(REASONS)('reaches the telemetry facade with reason %s', (reason) => {
    reportCompletionWriteDegradation(reason);

    expect(mockPushFaroEvent).toHaveBeenCalledTimes(1);
    expect(mockPushFaroEvent).toHaveBeenCalledWith('pathfinder_completion_write_degraded', { reason });
  });

  it('attaches the reason class and nothing else', () => {
    reportCompletionWriteDegradation('route-missing');

    const [, attributes] = mockPushFaroEvent.mock.calls[0];
    expect(Object.keys(attributes)).toEqual(['reason']);
  });

  it('stays silent instead of throwing when the facade cannot be resolved', () => {
    jest.isolateModules(() => {
      jest.doMock('../lib/telemetry/facade', () => {
        throw new Error('facade module missing');
      });
      const { reportCompletionWriteDegradation: report } = require('./completion-write-telemetry');

      expect(() => report('route-missing')).not.toThrow();
    });
    jest.dontMock('../lib/telemetry/facade');

    expect(mockPushFaroEvent).not.toHaveBeenCalled();
  });
});
