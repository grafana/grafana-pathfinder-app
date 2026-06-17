import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CrossTabTransport, createSenderId } from '../lib/cross-tab-transport';
import type { CrossTabMessage, CrossTabPayload } from '../types/cross-tab.types';

const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_STALE_MS = 5000;

interface ChannelTransport {
  start(): void;
  stop(): void;
  post(payload: CrossTabPayload): void;
  onMessage(listener: (message: CrossTabMessage) => void): () => void;
}

interface ControllerChannel {
  post: (payload: CrossTabPayload) => void;
  connected: boolean;
}

const ControllerChannelContext = createContext<ControllerChannel | null>(null);

export function useControllerChannel(): ControllerChannel | null {
  return useContext(ControllerChannelContext);
}

export function ControllerChannelProvider({
  children,
  transport,
}: {
  children: React.ReactNode;
  transport?: ChannelTransport;
}) {
  const [active] = useState<ChannelTransport>(() => transport ?? new CrossTabTransport(createSenderId()));
  const [connected, setConnected] = useState(false);
  const lastLiveSeenRef = useRef(0);

  useEffect(() => {
    active.start();

    const unsubscribe = active.onMessage((message) => {
      if (message.kind === 'heartbeat' && message.role === 'live') {
        lastLiveSeenRef.current = Date.now();
        setConnected(true);
      }
    });

    const tick = () => {
      active.post({ kind: 'heartbeat', role: 'controller' });
      if (lastLiveSeenRef.current > 0 && Date.now() - lastLiveSeenRef.current > HEARTBEAT_STALE_MS) {
        setConnected(false);
      }
    };
    tick();
    const intervalId = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      unsubscribe();
      active.stop();
    };
  }, [active]);

  const channel = useMemo<ControllerChannel>(
    () => ({ post: (payload) => active.post(payload), connected }),
    [active, connected]
  );

  return <ControllerChannelContext.Provider value={channel}>{children}</ControllerChannelContext.Provider>;
}
