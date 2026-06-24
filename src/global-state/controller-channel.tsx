import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CrossTabTransport, createSenderId } from '../lib/cross-tab-transport';
import type {
  CheckRequirementsMessage,
  CrossTabMessage,
  CrossTabPayload,
  FixRequirementMessage,
  RemoteRequirementResult,
} from '../types/cross-tab.types';

const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_STALE_MS = 5000;
// Requirement/fix round-trips fall back after this; step-run completion is
// unbounded (guided is human-paced) and fails only when the paired tab goes stale.
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

type RequestPayload =
  | Omit<CheckRequirementsMessage, 'source' | 'senderId' | 'timestamp' | 'requestId'>
  | Omit<FixRequirementMessage, 'source' | 'senderId' | 'timestamp' | 'requestId'>;

interface ControllerChannel {
  post: (payload: CrossTabPayload) => void;
  /** Ask the live tab to evaluate a step's requirements; resolves null on timeout. */
  requestRequirementCheck: (
    stepId: string,
    requirements: string,
    opts?: { targetAction?: string; refTarget?: string; targetValue?: string }
  ) => Promise<RemoteRequirementResult | null>;
  requestFix: (
    stepId: string,
    opts: { requirements: string; fixType?: string; targetHref?: string; scrollContainer?: string }
  ) => Promise<FixOutcome>;
  awaitStepComplete: (stepId: string) => Promise<boolean>;
  /** Abandon a pending awaitStepComplete waiter (user cancelled); resolves it false. */
  cancelStepComplete: (stepId: string) => void;
  /** Subscribe to a composite step's per-action progress; returns an unsubscribe. */
  onStepProgress: (stepId: string, cb: (index: number, total: number) => void) => () => void;
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
  // The one live tab this controller is bound to (first to send a `live`
  // heartbeat); replies from any other tab are ignored.
  const pairedLiveIdRef = useRef<string | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const stepCompletionRef = useRef<Map<string, (ok: boolean) => void>>(new Map());
  const stepProgressRef = useRef<Map<string, (index: number, total: number) => void>>(new Map());

  const post = useCallback((payload: CrossTabPayload) => active.post(payload), [active]);

  useEffect(() => {
    active.start();
    // Hand the main window's sidebar off to this controller tab while it drives.
    active.post({ kind: 'sidebar-handoff', action: 'close' });

    const pending = pendingRef.current;
    const stepDone = stepCompletionRef.current;
    const settle = (requestId: string, value: RemoteRequirementResult | FixOutcome | null) => {
      const entry = pending.get(requestId);
      if (!entry) {
        return;
      }
      clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(value);
    };
    const failAllPending = () => {
      pending.forEach((entry) => {
        clearTimeout(entry.timer);
        entry.resolve(null);
      });
      pending.clear();
      stepDone.forEach((resolve) => resolve(false));
      stepDone.clear();
    };

    const unsubscribe = active.onMessage((message) => {
      if (message.kind === 'heartbeat') {
        if (message.role !== 'live') {
          return;
        }
        // PAIRING SITE. TODO(twotab): v1 ships without a sender handshake — the
        // controller binds to the first live tab that sends a `live` heartbeat,
        // so any same-origin script that learns the channel name can claim this
        // slot with a forged heartbeat. Once paired it can drive check-requirements
        // / fix-requirement, which run navigation + DOM mutation against the
        // authenticated live tab (the highest-risk surface, #1070). Per-kind
        // validation gates message SHAPE, not AUTHORIZATION. Future work: a
        // gesture-to-accept on the live tab or an out-of-band nonce at controller
        // open. See CROSS_TAB_CONTROLLER.md "Known limitations".
        if (pairedLiveIdRef.current === null) {
          pairedLiveIdRef.current = message.senderId;
        }
        if (message.senderId !== pairedLiveIdRef.current) {
          return;
        }
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
        return;
      }
      if (
        message.kind !== 'requirement-result' &&
        message.kind !== 'fix-result' &&
        message.kind !== 'step-complete' &&
        message.kind !== 'step-progress'
      ) {
        return;
      }
      // T1 PART C: pairing happens on a heartbeat ONLY (above) — never adopt a
      // sender from a reply, or a forged first reply could claim the pairing slot
      // before any live tab heartbeats (first-responder spoof, F-1073 / F-1084).
      // An unpaired or mismatched sender is dropped.
      if (pairedLiveIdRef.current === null || message.senderId !== pairedLiveIdRef.current) {
        return;
      }
      if (message.kind === 'requirement-result') {
        settle(message.requestId, message.result);
      } else if (message.kind === 'fix-result') {
        settle(message.requestId, { ok: message.ok, error: message.error });
      } else if (message.kind === 'step-progress') {
        stepProgressRef.current.get(message.stepId)?.(message.index, message.total);
      } else {
        const resolve = stepDone.get(message.stepId);
        if (resolve) {
          stepDone.delete(message.stepId);
          resolve(message.ok);
        }
      }
    });

    const tick = () => {
      active.post({ kind: 'heartbeat', role: 'controller' });
      if (lastLiveSeenRef.current > 0 && Date.now() - lastLiveSeenRef.current > HEARTBEAT_STALE_MS) {
        setConnected(false);
        // Paired tab gone: drop the binding to allow re-pairing and fail waiters.
        pairedLiveIdRef.current = null;
        failAllPending();
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
      failAllPending();
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
        post({ ...payload, requestId });
      });
    },
    [post]
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

  const awaitStepComplete = useCallback<ControllerChannel['awaitStepComplete']>(
    (stepId) =>
      new Promise<boolean>((resolve) => {
        // A re-run for the same step supersedes any earlier waiter.
        stepCompletionRef.current.get(stepId)?.(false);
        stepCompletionRef.current.set(stepId, resolve);
      }),
    []
  );

  const cancelStepComplete = useCallback<ControllerChannel['cancelStepComplete']>((stepId) => {
    const resolve = stepCompletionRef.current.get(stepId);
    if (resolve) {
      stepCompletionRef.current.delete(stepId);
      resolve(false);
    }
  }, []);

  // One subscriber per stepId (last writer wins). The unsubscribe only deletes
  // if its own callback is still registered, so a superseding subscriber for the
  // same step isn't evicted by the previous one's cleanup.
  const onStepProgress = useCallback<ControllerChannel['onStepProgress']>((stepId, cb) => {
    stepProgressRef.current.set(stepId, cb);
    return () => {
      if (stepProgressRef.current.get(stepId) === cb) {
        stepProgressRef.current.delete(stepId);
      }
    };
  }, []);

  // The channel value omits `connected` (it lives in ControllerConnectionContext)
  // and depends only on the useCallback-stable post + round-trip helpers, so it
  // stays referentially stable across heartbeat ticks — step consumers don't
  // re-render (NEW-1065-1).
  const channel = useMemo<ControllerChannel>(
    () => ({ post, requestRequirementCheck, requestFix, awaitStepComplete, cancelStepComplete, onStepProgress }),
    [post, requestRequirementCheck, requestFix, awaitStepComplete, cancelStepComplete, onStepProgress]
  );

  return (
    <ControllerChannelContext.Provider value={channel}>
      <ControllerConnectionContext.Provider value={connected}>{children}</ControllerConnectionContext.Provider>
    </ControllerChannelContext.Provider>
  );
}
