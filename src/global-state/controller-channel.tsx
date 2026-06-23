import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CrossTabTransport, createSenderId } from '../lib/cross-tab-transport';
import type {
  CheckRequirementsMessage,
  CrossTabMessage,
  CrossTabPayload,
  FixRequirementMessage,
  RemoteRequirementResult,
} from '../types/cross-tab.types';

type RequestPayload =
  | Omit<CheckRequirementsMessage, 'source' | 'senderId' | 'timestamp' | 'requestId'>
  | Omit<FixRequirementMessage, 'source' | 'senderId' | 'timestamp' | 'requestId'>;

const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_STALE_MS = 5000;
// A live tab that never answers must not strand a step's spinner; fall back once
// the round-trip exceeds this budget.
const REQUEST_TIMEOUT_MS = 4000;

interface ChannelTransport {
  start(): void;
  stop(): void;
  post(payload: CrossTabPayload): void;
  onMessage(listener: (message: CrossTabMessage) => void): () => void;
}

interface FixOutcome {
  ok: boolean;
  error?: string;
}

interface ControllerChannel {
  post: (payload: CrossTabPayload) => void;
  /** Ask the live tab to evaluate a step's requirements; resolves null on timeout. */
  requestRequirementCheck: (
    stepId: string,
    requirements: string,
    opts?: { targetAction?: string; refTarget?: string; targetValue?: string }
  ) => Promise<RemoteRequirementResult | null>;
  /** Ask the live tab to run a requirement fix against its own DOM. */
  requestFix: (
    stepId: string,
    opts: { requirements: string; fixType?: string; targetHref?: string; scrollContainer?: string }
  ) => Promise<FixOutcome>;
}

interface PendingRequest {
  resolve: (value: RemoteRequirementResult | FixOutcome | null) => void;
  timer: ReturnType<typeof setTimeout>;
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
  const reassertedCloseRef = useRef(false);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());

  useEffect(() => {
    active.start();
    // Hand the main window's sidebar off to this controller tab while it drives.
    active.post({ kind: 'sidebar-handoff', action: 'close' });

    const pending = pendingRef.current;
    const settle = (requestId: string, value: RemoteRequirementResult | FixOutcome | null) => {
      const entry = pending.get(requestId);
      if (!entry) {
        return;
      }
      clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(value);
    };

    const unsubscribe = active.onMessage((message) => {
      if (message.kind === 'heartbeat' && message.role === 'live') {
        lastLiveSeenRef.current = Date.now();
        setConnected(true);
        if (!reassertedCloseRef.current) {
          // The initial close above may have been posted before any live tab
          // was listening (controller opened first, or the live tab mounted
          // late). Re-assert it once the first live heartbeat proves a live tab
          // exists, so the sidebar still hands off (F-1067-1). The flag stops
          // later reconnects from re-posting on every tick.
          reassertedCloseRef.current = true;
          active.post({ kind: 'sidebar-handoff', action: 'close' });
        }
      } else if (message.kind === 'requirement-result') {
        settle(message.requestId, message.result);
      } else if (message.kind === 'fix-result') {
        settle(message.requestId, { ok: message.ok, error: message.error });
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
      pending.forEach((entry) => {
        clearTimeout(entry.timer);
        entry.resolve(null);
      });
      pending.clear();
    };
  }, [active]);

  const request = useCallback(
    <T extends RemoteRequirementResult | FixOutcome | null>(payload: RequestPayload, fallback: T): Promise<T> => {
      // Globally unique so a reply can never settle the wrong pending request:
      // a per-instance sequence (`req-1`, `req-2`, …) collides across two
      // controller tabs sharing the channel, and a stray reply would resolve the
      // other controller's same-numbered request (F-1070-1).
      const requestId = crypto.randomUUID();
      return new Promise<T>((resolve) => {
        const timer = setTimeout(() => {
          pendingRef.current.delete(requestId);
          resolve(fallback);
        }, REQUEST_TIMEOUT_MS);
        pendingRef.current.set(requestId, { resolve: resolve as PendingRequest['resolve'], timer });
        active.post({ ...payload, requestId });
      });
    },
    [active]
  );

  const requestRequirementCheck = useCallback<ControllerChannel['requestRequirementCheck']>(
    (stepId, requirements, opts) =>
      request(
        {
          kind: 'check-requirements',
          stepId,
          requirements,
          targetAction: opts?.targetAction,
          refTarget: opts?.refTarget,
          targetValue: opts?.targetValue,
        },
        null
      ),
    [request]
  );

  const requestFix = useCallback<ControllerChannel['requestFix']>(
    (stepId, opts) =>
      request(
        {
          kind: 'fix-requirement',
          stepId,
          requirements: opts.requirements,
          fixType: opts.fixType,
          targetHref: opts.targetHref,
          scrollContainer: opts.scrollContainer,
        },
        { ok: false, error: 'No live tab responded' }
      ),
    [request]
  );

  // The channel value omits `connected` (it lives in ControllerConnectionContext)
  // and depends only on `active` plus the useCallback-stable round-trip helpers,
  // so it stays referentially stable across heartbeat ticks — step consumers
  // don't re-render (NEW-1065-1).
  const channel = useMemo<ControllerChannel>(
    () => ({ post: (payload) => active.post(payload), requestRequirementCheck, requestFix }),
    [active, requestRequirementCheck, requestFix]
  );

  return (
    <ControllerChannelContext.Provider value={channel}>
      <ControllerConnectionContext.Provider value={connected}>{children}</ControllerConnectionContext.Provider>
    </ControllerChannelContext.Provider>
  );
}
