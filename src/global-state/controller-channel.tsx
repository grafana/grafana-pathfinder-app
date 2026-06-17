import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { CrossTabTransport, createSenderId } from '../lib/cross-tab-transport';
import type { CrossTabPayload } from '../types/cross-tab.types';

interface ChannelTransport {
  start(): void;
  stop(): void;
  post(payload: CrossTabPayload): void;
}

interface ControllerChannel {
  post: (payload: CrossTabPayload) => void;
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

  useEffect(() => {
    active.start();
    return () => active.stop();
  }, [active]);

  const channel = useMemo<ControllerChannel>(() => ({ post: (payload) => active.post(payload) }), [active]);

  return <ControllerChannelContext.Provider value={channel}>{children}</ControllerChannelContext.Provider>;
}
