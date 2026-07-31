import {
  BaseTransport,
  initializeFaro,
  SessionInstrumentation,
  type Faro,
  type TransportItem,
} from '@grafana/faro-web-sdk';
import { activateSessionReplay, resolveSamplingRate } from './replay';

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

  // The rate is a remote number, so it can arrive as anything. Falling back to
  // the default beats silently recording nobody — see #1275, where an earlier
  // Faro sample-rate flag was deleted rather than clamped.
  describe('resolveSamplingRate', () => {
    it.each([1, 0.5, 0.1, 0])('honors the in-range value %p', (rate) => {
      expect(resolveSamplingRate(rate)).toBe(rate);
    });

    it.each([
      ['undefined (flag unset)', undefined],
      ['a percentage mistaken for a fraction', 100],
      ['a negative rate', -1],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['a string from a mistyped remote value', '0.5' as unknown as number],
    ])('falls back to 1 for %s', (_label, rate) => {
      expect(resolveSamplingRate(rate)).toBe(1);
    });
  });

  it('keeps the session id stable across those stamps', () => {
    const id = faro.api.getSession()?.id;
    stampSurface('fullscreen');
    expect(faro.api.getSession()?.id).toBe(id);
    expect(faro.api.getSession()?.attributes?.['surface']).toBe('fullscreen');
  });
});
