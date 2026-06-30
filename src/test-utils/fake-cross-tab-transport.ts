import type { ControllerPairingLaunch } from '../lib/pairing-manager';
import type { CrossTabMessage } from '../types/cross-tab.types';

/**
 * In-memory single-listener stand-in for `CrossTabTransport`, shared by the
 * controller-channel and live-tab-executor suites. `emit` feeds a message to
 * the registered listener as if it arrived on the channel; `post` records
 * outbound payloads for assertions. The multi-endpoint `TestBus` in the
 * protocol acceptance suite is a deliberately richer thing and stays separate.
 */
export class FakeCrossTabTransport {
  started = false;
  stopped = false;
  senderId: string;
  postedMessages: unknown[] = [];
  private listener: ((message: CrossTabMessage) => void) | null = null;

  constructor(senderId = 'fake-sender') {
    this.senderId = senderId;
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  post(payload: unknown): void {
    this.postedMessages.push(payload);
  }

  getSenderId(): string {
    return this.senderId;
  }

  onMessage(listener: (message: CrossTabMessage) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(message: CrossTabMessage): void {
    this.listener?.(message);
  }
}

/** Canonical pairing-launch fixture used across the cross-tab test suites. */
export const TEST_PAIRING: ControllerPairingLaunch = {
  pairingId: 'pairing-1',
  pairingSecret: 'secret-1',
  pairingCode: '123456',
};
