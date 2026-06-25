import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CrossTabTransport, createSenderId } from '../lib/cross-tab-transport';
import { createSignatureNonce, signSignedMessage } from '../lib/pairing-manager';
import { generateSessionKeyPair } from '../security/cross-tab-crypto';
import type {
  CheckRequirementsMessage,
  CrossTabMessage,
  CrossTabPayload,
  FixRequirementMessage,
  RemoteRequirementResult,
} from '../types/cross-tab.types';

const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_STALE_MS = 5000;
const REQUEST_TIMEOUT_MS = 4000;
const SIGNED_KINDS = new Set(['step-command', 'check-requirements', 'fix-requirement', 'sidebar-handoff']);

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
  cancelStepComplete: (stepId: string, runId: string) => void;
  onStepProgress: (stepId: string, runId: string, cb: (index: number, total: number) => void) => () => void;
}

interface PendingRequest {
  resolve: (value: RemoteRequirementResult | FixOutcome | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

const ControllerChannelContext = createContext<ControllerChannel | null>(null);
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

  const postPayload = useCallback(
    async (payload: CrossTabPayload): Promise<void> => {
      const liveTabId = pairedLiveIdRef.current;
      const privateKey = privateKeyRef.current;
      const sid = sessionId;
      if (!SIGNED_KINDS.has(payload.kind)) {
        active.post(payload);
        return;
      }
      if (!liveTabId || !privateKey) {
        return;
      }
      const signedPayload = {
        ...payload,
        sessionId: sid,
        liveTabId,
        sigTs: Date.now(),
        sigNonce: createSignatureNonce(),
      };
      try {
        const sig = await signSignedMessage(privateKey, signedPayload);
        active.post({ ...signedPayload, sig } as CrossTabPayload);
      } catch {
        return;
      }
    },
    [active, sessionId]
  );

  const post = useCallback(
    (payload: CrossTabPayload): void => {
      void postPayload(payload);
    },
    [postPayload]
  );

  useEffect(() => {
    generateSessionKeyPair()
      .then(({ publicKeyB64, privateKey }) => {
        privateKeyRef.current = privateKey;
        publicKeyB64Ref.current = publicKeyB64;
        active.post({ kind: 'pairing-challenge', sessionId: sessionId, publicKeyB64 });
      })
      .catch(() => {
        privateKeyRef.current = null;
        publicKeyB64Ref.current = null;
      });
  }, [active, sessionId]);

  useEffect(() => {
    active.start();

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
      if (message.kind === 'pairing-accept') {
        if (message.sessionId !== sessionId) {
          return;
        }
        if (pairedLiveIdRef.current === null) {
          pairedLiveIdRef.current = message.senderId;
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
      if (pairedLiveIdRef.current === null && publicKeyB64Ref.current) {
        active.post({
          kind: 'pairing-challenge',
          sessionId: sessionId,
          publicKeyB64: publicKeyB64Ref.current,
        });
      }
      if (lastLiveSeenRef.current > 0 && Date.now() - lastLiveSeenRef.current > HEARTBEAT_STALE_MS) {
        setConnected(false);
        pairedLiveIdRef.current = null;
        failAllPending();
      }
    };
    tick();
    const intervalId = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    const handBack = () => postPayload({ kind: 'sidebar-handoff', action: 'reopen' });
    window.addEventListener('pagehide', handBack);

    return () => {
      window.removeEventListener('pagehide', handBack);
      const shouldWaitForHandBack = pairedLiveIdRef.current !== null && privateKeyRef.current !== null;
      const handBackPromise = handBack();
      clearInterval(intervalId);
      unsubscribe();
      failAllPending();
      if (shouldWaitForHandBack) {
        void handBackPromise.finally(() => active.stop());
      } else {
        active.stop();
      }
    };
  }, [active, post, postPayload, sessionId]);

  const request = useCallback(
    <T extends RemoteRequirementResult | FixOutcome | null>(payload: RequestPayload, fallback: T): Promise<T> => {
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
