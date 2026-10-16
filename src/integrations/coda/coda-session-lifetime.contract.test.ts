import { CodaSession } from '@grafana/coda-client';
import { Subject } from 'rxjs';

const stream = new Subject<unknown>();
const publish = jest.fn().mockResolvedValue(undefined);

jest.mock('@grafana/runtime', () => ({
  getGrafanaLiveSrv: () => ({ getStream: () => stream, publish }),
  getBackendSrv: jest.fn(),
  isAppPluginEnabled: jest.fn(),
}));

it('keeps publishing keyboard input to the same session after a lifetime extension', async () => {
  const session = new CodaSession(
    {
      sessionId: 's_extension',
      channel: 'plugin/grafana-coda-app/v1/session/s_extension',
      state: 'pending',
      template: 'vm-microvm',
    },
    {
      timings: { heartbeatIntervalMs: 3000, estimatedProvisionMs: 55000, maxProvisionMs: 180000 },
      exec: jest.fn(),
      destroy: jest.fn().mockResolvedValue(undefined),
    }
  );
  const onStatus = jest.fn();
  const onConnected = jest.fn();
  const frame = (event: object) =>
    stream.next({ type: 'message', message: { data: { values: [[JSON.stringify(event)]] } } });

  try {
    session.subscribe({ onStatus, onConnected });
    frame({ type: 'connected', vmId: 'vm-extension' });
    session.write('before\n');
    expect(publish).toHaveBeenCalledTimes(1);
    const channel = publish.mock.calls[0]![0];
    publish.mockClear();

    const expiresAt = '2099-01-01T01:00:00Z';
    frame({ type: 'status', state: 'lifetime_updated', vmId: 'vm-extension', expiresAt });
    session.write('after\n');

    expect(publish).toHaveBeenCalledWith(channel, { type: 'input', data: 'after\n' }, { useSocket: true });
    expect(session.status).toBe('connected');
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'lifetime_updated', expiresAt }));
    expect(onConnected).toHaveBeenCalledTimes(1);
  } finally {
    await session.close();
  }
});
