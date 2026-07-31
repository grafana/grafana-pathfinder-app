import {
  BaseTransport,
  initializeFaro,
  SessionInstrumentation,
  type Faro,
  type TransportItem,
} from '@grafana/faro-web-sdk';
import { activateSessionReplay } from './replay';

class CaptureTransport extends BaseTransport {
  readonly name = '@pathfinder/replay-lifecycle-transport';
  readonly version = '0.0.0';
  items: TransportItem[] = [];
  send(items: TransportItem | TransportItem[]): void {
    this.items.push(...(Array.isArray(items) ? items : [items]));
  }
}

// Against the real SDK and the real rrweb recorder: faro-core's setSession()
// removes the session meta before re-adding it, and both halves notify metas
// listeners. Without a guard the recorder stops on the session-less
// notification and restarts on the next one, so a sidebar toggle produced a
// fresh full-DOM snapshot and a new clip instead of one continuous recording.
describe('session replay lifecycle across session-attribute stamps', () => {
  const transport = new CaptureTransport();
  let faro: Faro;

  const recordingEvents = () =>
    transport.items
      .filter((item) => item.type === 'event')
      .map((item) => (item.payload as { name?: string }).name ?? '')
      .filter((name) => name.startsWith('faro.session_recording.') && name !== 'faro.session_recording.event');

  const stampSurface = (surface: string) => {
    const session = faro.api.getSession();
    faro.api.setSession({ ...session, attributes: { ...session?.attributes, surface } });
  };

  beforeAll(async () => {
    faro = initializeFaro({
      app: { name: 'pathfinder-replay-lifecycle', version: '0.0.0' },
      transports: [transport],
      instrumentations: [new SessionInstrumentation()],
      sessionTracking: { enabled: true, persistent: false, session: { attributes: { surface: 'closed' } } },
      isolate: true,
      globalObjectKey: 'pathfinderReplayLifecycle',
      batching: { enabled: false },
      dedupe: false,
    });
    await activateSessionReplay(faro);
  });

  it('starts recording exactly once', () => {
    expect(recordingEvents()).toEqual(['faro.session_recording.started']);
  });

  it('does not restart when the surface is stamped onto the session', () => {
    stampSurface('sidebar');
    stampSurface('closed');
    stampSurface('sidebar');

    expect(recordingEvents()).toEqual(['faro.session_recording.started']);
  });

  it('keeps the session id stable across those stamps', () => {
    const id = faro.api.getSession()?.id;
    stampSurface('fullscreen');
    expect(faro.api.getSession()?.id).toBe(id);
    expect(faro.api.getSession()?.attributes?.['surface']).toBe('fullscreen');
  });
});
