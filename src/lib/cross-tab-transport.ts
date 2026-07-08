import {
  CROSS_TAB_CHANNEL,
  type CrossTabMessage,
  type CrossTabPayload,
  validateCrossTabMessage,
} from '../types/cross-tab.types';
import { logger } from './logging';

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export type CrossTabListener = (message: CrossTabMessage) => void;

type ChannelFactory = (name: string) => BroadcastChannelLike | null;

const defaultChannelFactory: ChannelFactory = (name) =>
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name);

export function createSenderId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export class CrossTabTransport {
  private channel: BroadcastChannelLike | null = null;
  private readonly listeners = new Set<CrossTabListener>();

  constructor(
    private readonly senderId: string,
    private readonly channelFactory: ChannelFactory = defaultChannelFactory
  ) {}

  start(): void {
    if (this.channel) {
      return;
    }
    this.channel = this.channelFactory(CROSS_TAB_CHANNEL);
    if (this.channel) {
      this.channel.onmessage = this.handleMessage;
    }
  }

  stop(): void {
    if (!this.channel) {
      return;
    }
    this.channel.onmessage = null;
    this.channel.close();
    this.channel = null;
    this.listeners.clear();
  }

  getSenderId(): string {
    return this.senderId;
  }

  isActive(): boolean {
    return this.channel !== null;
  }

  post(payload: CrossTabPayload): void {
    if (!this.channel) {
      return;
    }
    const message = {
      ...payload,
      source: 'pathfinder',
      senderId: this.senderId,
      timestamp: Date.now(),
    } as CrossTabMessage;
    this.channel.postMessage(message);
  }

  onMessage(listener: CrossTabListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private readonly handleMessage = (event: MessageEvent): void => {
    const message = validateCrossTabMessage(event.data);
    if (!message || message.senderId === this.senderId) {
      return;
    }
    this.listeners.forEach((listener) => {
      try {
        listener(message);
      } catch (err) {
        // One throwing listener must not starve the rest (F-1056-5).
        logger.error('cross-tab listener threw', { error: err });
      }
    });
  };
}
