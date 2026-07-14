import { pushFaroError, pushFaroLog, pushFaroUserAction, registerTelemetryBridge } from './bridge';

describe('telemetry bridge', () => {
  it('no-ops before the adapter registers (entry code must never throw)', () => {
    jest.resetModules();
    const bridge: typeof import('./bridge') = require('./bridge');

    expect(() => bridge.pushFaroUserAction('pathfinder_click', { a: 1 })).not.toThrow();
    expect(() => bridge.pushFaroError(new Error('boom'))).not.toThrow();
    expect(() => bridge.pushFaroLog('warn', 'msg')).not.toThrow();
  });

  it('forwards to the registered adapter implementation', () => {
    const impl = {
      pushFaroUserAction: jest.fn(),
      pushFaroError: jest.fn(),
      pushFaroLog: jest.fn(),
    };
    registerTelemetryBridge(impl);

    pushFaroUserAction('pathfinder_click', { a: 1 });
    const error = new Error('boom');
    pushFaroError(error, { source: 'test' });
    pushFaroLog('warn', 'msg', { k: 'v' });

    expect(impl.pushFaroUserAction).toHaveBeenCalledWith('pathfinder_click', { a: 1 });
    expect(impl.pushFaroError).toHaveBeenCalledWith(error, { source: 'test' });
    expect(impl.pushFaroLog).toHaveBeenCalledWith('warn', 'msg', { k: 'v' });
  });
});
