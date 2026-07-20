/**
 * Contract tests against the *installed* @grafana/faro-web-sdk (not a mock).
 *
 * pushFaroUserAction() casts startUserAction()'s result to
 * UserActionInternalInterface to call end() — an internal API with no public
 * equivalent. A type-level rename fails the build, but a runtime-semantics
 * change (end() no longer emitting the faro.user.action event) would compile
 * and silently kill the analytics mirror. These tests fail loudly on an SDK
 * bump instead.
 */
import {
  BaseTransport,
  initializeFaro,
  type TransportItem,
  type UserActionInternalInterface,
} from '@grafana/faro-web-sdk';

class CaptureTransport extends BaseTransport {
  readonly name = '@pathfinder/capture-transport';
  readonly version = '0.0.0';
  items: TransportItem[] = [];

  send(items: TransportItem | TransportItem[]): void {
    this.items.push(...(Array.isArray(items) ? items : [items]));
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('faro-web-sdk user action contract', () => {
  const transport = new CaptureTransport();
  const faro = initializeFaro({
    app: { name: 'pathfinder-sdk-contract-test', version: '0.0.0' },
    transports: [transport],
    instrumentations: [],
    isolate: true,
    globalObjectKey: 'pathfinderSdkContractTest',
    batching: { enabled: false },
    dedupe: false,
  });

  it('startUserAction returns an action exposing the internal end()', () => {
    const action = faro.api.startUserAction('pathfinder_contract_check', { seq: '0' });
    expect(action).toBeDefined();
    expect(typeof (action as UserActionInternalInterface).end).toBe('function');
    (action as UserActionInternalInterface).end();
  });

  it('ending the action emits a faro.user.action event that reaches the transport', async () => {
    transport.items = [];
    const action = faro.api.startUserAction('pathfinder_contract_emit', { seq: '1' });
    (action as UserActionInternalInterface | undefined)?.end();

    await waitFor(() =>
      transport.items.some(
        (item) => item.type === 'event' && (item.payload as { name?: string }).name === 'faro.user.action'
      )
    );

    const userActionEvent = transport.items.find(
      (item) => item.type === 'event' && (item.payload as { name?: string }).name === 'faro.user.action'
    );
    expect(userActionEvent).toBeDefined();
    expect(JSON.stringify(userActionEvent!.payload)).toContain('pathfinder_contract_emit');
  });
});
