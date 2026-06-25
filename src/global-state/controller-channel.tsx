import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CrossTabTransport, createSenderId } from '../lib/cross-tab-transport';
import { generateSessionKeyPair, signPayload } from '../security/cross-tab-crypto';
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
  awaitStepComplete: (stepId: string, runId: string) => Promise<boolean>;
  /** Abandon a pending awaitStepComplete waiter (user cancelled); resolves it false. */
  cancelStepComplete: (stepId: string, runId: string) => void;
  /** Subscribe to a composite step's per-action progress; returns an unsubscribe. */
  onStepProgress: (stepId: string, runId: string, cb: (index: number, total: number) => void) => () => void;
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
  const [[sessionId, active]] = useState<[string, ChannelTransport]>(() => {
    const sid = createSenderId();
    return [sid, transport ?? new CrossTabTransport(sid)];
  });
  const [connected, setConnected] = useState(false);
  const privateKeyRef = useRef<CryptoKey | null>(null);
  const publicKeyB64Ref = useRef<string | null>(null);
  const lastLiveSeenRef = useRef(0);
  // The one live tab this controller is bound to (first to send a `live`
  // heartbeat); replies from any other tab are ignored.
  const pairedLiveIdRef = useRef<string | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const stepCompletionRef = useRef<Map<string, (ok: boolean) => void>>(new Map());
  const stepProgressRef = useRef<Map<string, (index: number, total: number) => void>>(new Map());

  const SIGNED_KINDS = new Set(['step-command', 'check-requirements', 'fix-requirement', 'sidebar-handoff']);

  const post = useCallback(
    (payload: CrossTabPayload): void => {
      const liveTabId = pairedLiveIdRef.current;
      const privateKey = privateKeyRef.current;
      const sid = sessionId;
      if (SIGNED_KINDS.has(payload.kind) && liveTabId && privateKey) {
        const sigTs = Date.now();
        const canonical = `${sid}|${liveTabId}|${payload.kind}|${sigTs}`;
        void signPayload(privateKey, canonical)
          .then((sig) => {
            active.post({ ...payload, sig, sessionId: sid, liveTabId, sigTs } as CrossTabPayload);
          })
          .catch(() => {
            // Drop rather than send unsigned.
          });
      } else {
        active.post(payload);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active]
  );

  useEffect(() => {
    // Generate session key pair; announce challenge once ready.
    generateSessionKeyPair()
      .then(({ publicKeyB64, privateKey }) => {
        privateKeyRef.current = privateKey;
        publicKeyB64Ref.current = publicKeyB64;
        active.post({ kind: 'pairing-challenge', sessionId: sessionId, publicKeyB64 });
      })
      .catch(() => {
        // Non-fatal; controller will not be able to sign commands.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    active.start();
    // sidebar-handoff is now gated behind auth; send it after pairing-accept arrives.

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
      stepProgressRef.current.clear();
    };

    const unsubscribe = active.onMessage((message) => {
      // Live tab accepted the pairing challenge: bind the live tab ID so
      // signed commands target only this tab.
      if (message.kind === 'pairing-accept') {
        if (message.sessionId !== sessionId) {
          return;
        }
        if (pairedLiveIdRef.current === null) {
          pairedLiveIdRef.current = message.senderId;
          // Now paired: send the sidebar-handoff so the live tab closes its sidebar.
          post({ kind: 'sidebar-handoff', action: 'close' });
        }
        return;
      }

      if (message.kind === 'heartbeat') {
        if (message.role !== 'live') {
          return;
        }
        if (pairedLiveIdRef.current === null || message.senderId !== pairedLiveIdRef.current) {
          return;
        }
        lastLiveSeenRef.current = Date.now();
        setConnected(true);
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
      // before any live tab heartbeats. An unpaired or mismatched sender is dropped.
      if (pairedLiveIdRef.current === null || message.senderId !== pairedLiveIdRef.current) {
        return;
      }
      if (message.kind === 'requirement-result') {
        settle(message.requestId, message.result);
      } else if (message.kind === 'fix-result') {
        settle(message.requestId, { ok: message.ok, error: message.error });
      } else if (message.kind === 'step-progress') {
        const key = `${message.stepId}:${message.runId}`;
        stepProgressRef.current.get(key)?.(message.index, message.total);
      } else {
        const key = `${message.stepId}:${message.runId}`;
        const resolve = stepDone.get(key);
        if (resolve) {
          stepDone.delete(key);
          resolve(message.ok);
        }
      }
    });

    const tick = () => {
      active.post({ kind: 'heartbeat', role: 'controller' });
      // Re-announce the pairing challenge while unpaired so a live tab that
      // starts after the controller still receives the public key.
      if (pairedLiveIdRef.current === null && publicKeyB64Ref.current) {
        active.post({
          kind: 'pairing-challenge',
          sessionId: sessionId,
          publicKeyB64: publicKeyB64Ref.current,
        });
      }
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
  }, [active, post, sessionId]);

  const request = useCallback(
    <T extends RemoteRequirementResult | FixOutcome | null>(payload: RequestPayload, fallback: T): Promise<T> => {
      // Globally unique so a reply can never settle the wrong pending request:
      // a per-instance sequence (`req-1`, `req-2`, …) collides across two
      // controller tabs sharing the channel, and a stray reply would resolve the
      // other controller's same-numbered request.
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
    (stepId, runId) =>
      new Promise<boolean>((resolve) => {
        stepCompletionRef.current.set(`${stepId}:${runId}`, resolve);
      }),
    []
  );

  const cancelStepComplete = useCallback<ControllerChannel['cancelStepComplete']>((stepId, runId) => {
    const key = `${stepId}:${runId}`;
    const resolve = stepCompletionRef.current.get(key);
    if (resolve) {
      stepCompletionRef.current.delete(key);
      resolve(false);
    }
  }, []);

  const onStepProgress = useCallback<ControllerChannel['onStepProgress']>((stepId, runId, cb) => {
    const key = `${stepId}:${runId}`;
    stepProgressRef.current.set(key, cb);
    return () => {
      if (stepProgressRef.current.get(key) === cb) {
        stepProgressRef.current.delete(key);
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
