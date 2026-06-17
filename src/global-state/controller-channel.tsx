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
}

const ControllerChannelContext = createContext<ControllerChannel | null>(null);
// Connection state lives in its own context: the heartbeat flips `connected`
// every few seconds, and folding it into the channel value would re-render
// every InteractiveStep that only needs `post`. The status badge is the sole
// consumer of this context (NEW-1065-1).
const ControllerConnectionContext = createContext<boolean>(false);

export function useControllerChannel(): ControllerChannel | null {
  return useContext(ControllerChannelContext);
}

export function useControllerConnected(): boolean {
  return useContext(ControllerConnectionContext);
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
    // Hand the main window's sidebar off to this controller tab while it drives.
    active.post({ kind: 'sidebar-handoff', action: 'close' });

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

    // Closing the controller tab (or unmounting) hands the sidebar back.
    const handBack = () => active.post({ kind: 'sidebar-handoff', action: 'reopen' });
    window.addEventListener('pagehide', handBack);

    return () => {
      window.removeEventListener('pagehide', handBack);
      handBack();
      clearInterval(intervalId);
      unsubscribe();
      active.stop();
    };
  }, [active]);

  // Depends only on `active`, so the channel value stays referentially stable
  // across heartbeat ticks — step consumers don't re-render (NEW-1065-1).
  const channel = useMemo<ControllerChannel>(() => ({ post: (payload) => active.post(payload) }), [active]);

  return (
    <ControllerChannelContext.Provider value={channel}>
      <ControllerConnectionContext.Provider value={connected}>{children}</ControllerConnectionContext.Provider>
    </ControllerChannelContext.Provider>
  );
}
