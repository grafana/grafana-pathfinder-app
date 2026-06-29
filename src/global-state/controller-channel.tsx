import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CrossTabTransport, createSenderId } from '../lib/cross-tab-transport';
import {
  createPairingChallengeProof,
  createSignatureNonce,
  SIGNED_MESSAGE_STALE_MS,
  signSignedMessage,
  verifyPairingAcceptProof,
  type ControllerPairingLaunch,
} from '../lib/pairing-manager';
import { generateSessionKeyPair } from '../security/cross-tab-crypto';
import {
  SIGNED_MESSAGE_KINDS,
  type CheckRequirementsMessage,
  type CrossTabMessage,
  type CrossTabPayload,
  type FixRequirementMessage,
  type RemoteRequirementResult,
} from '../types/cross-tab.types';

const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_STALE_MS = 5000;
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
  pairing,
}: {
  children: React.ReactNode;
  transport?: ChannelTransport;
  pairing?: ControllerPairingLaunch | null;
}) {
  const [[sessionId, active]] = useState<[string, ChannelTransport]>(() => {
    const sid = createSenderId();
    return [sid, transport ?? new CrossTabTransport(sid)];
  });
  const [connected, setConnected] = useState(false);
  const privateKeyRef = useRef<CryptoKey | null>(null);
  const pairingChallengeRef = useRef<CrossTabPayload | null>(null);
  const preparedHandBackRef = useRef<CrossTabPayload | null>(null);
  const lastLiveSeenRef = useRef(0);
  // The one live tab this controller is bound to (first to send a `live`
  // heartbeat); replies from any other tab are ignored.
  const pairedLiveIdRef = useRef<string | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const stepCompletionRef = useRef<Map<string, (ok: boolean) => void>>(new Map());
  const stepProgressRef = useRef<Map<string, (index: number, total: number) => void>>(new Map());

  const signForLive = useCallback(
    async (payload: CrossTabPayload): Promise<CrossTabPayload | null> => {
      const liveTabId = pairedLiveIdRef.current;
      const privateKey = privateKeyRef.current;
      if (!liveTabId || !privateKey) {
        return null;
      }
      const signedPayload = {
        ...payload,
        sessionId,
        liveTabId,
        sigTs: Date.now(),
        sigNonce: createSignatureNonce(),
      };
      try {
        const sig = await signSignedMessage(privateKey, signedPayload);
        return { ...signedPayload, sig } as CrossTabPayload;
      } catch {
        return null;
      }
    },
    [sessionId]
  );

  const refreshPreparedHandBack = useCallback(async (): Promise<void> => {
    const signed = await signForLive({ kind: 'sidebar-handoff', action: 'reopen' });
    if (signed) {
      preparedHandBackRef.current = signed;
    }
  }, [signForLive]);

  const postPreparedHandBack = useCallback((): boolean => {
    const payload = preparedHandBackRef.current;
    if (!payload || payload.kind !== 'sidebar-handoff' || payload.sigTs === undefined) {
      return false;
    }
    if (Math.abs(Date.now() - payload.sigTs) > SIGNED_MESSAGE_STALE_MS) {
      return false;
    }
    active.post(payload);
    return true;
  }, [active]);

  const postPayload = useCallback(
    async (payload: CrossTabPayload): Promise<void> => {
      if (!SIGNED_MESSAGE_KINDS.has(payload.kind)) {
        active.post(payload);
        return;
      }
      const signed = await signForLive(payload);
      if (signed) {
        active.post(signed);
      }
    },
    [active, signForLive]
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
        if (!pairing) {
          return;
        }
        const challenge = { pairingId: pairing.pairingId, sessionId, publicKeyB64 };
        return createPairingChallengeProof(pairing.pairingSecret, challenge).then((pairingProof) => {
          const payload = { kind: 'pairing-challenge', ...challenge, pairingProof } as CrossTabPayload;
          pairingChallengeRef.current = payload;
          active.post(payload);
        });
      })
      .catch(() => {
        privateKeyRef.current = null;
        pairingChallengeRef.current = null;
      });
  }, [active, pairing, sessionId]);

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
        if (message.sessionId !== sessionId || pairedLiveIdRef.current !== null || !pairing) {
          return;
        }
        if (message.pairingId !== pairing.pairingId) {
          return;
        }
        const liveTabId = message.senderId;
        const binding = { pairingId: message.pairingId, sessionId, liveTabId };
        void verifyPairingAcceptProof(pairing.pairingSecret, binding, message.acceptProof).then((ok) => {
          if (!ok || pairedLiveIdRef.current !== null) {
            return;
          }
          pairedLiveIdRef.current = liveTabId;
          void refreshPreparedHandBack().finally(() => post({ kind: 'sidebar-handoff', action: 'close' }));
        });
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
      // live→controller replies are unauthenticated by design: senderId is a
      // forgeable plaintext field, so this only scopes replies to the paired
      // tab, it does not prove origin. A same-origin script can spoof reply
      // CONTENT (mislead this controller's UI) but cannot issue commands or
      // drive the live tab — that requires the controller private key. See
      // docs/developer/CROSS_TAB_CONTROLLER.md "Known limitations".
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
      if (pairedLiveIdRef.current === null && pairingChallengeRef.current) {
        active.post(pairingChallengeRef.current);
      }
      if (pairedLiveIdRef.current !== null) {
        void refreshPreparedHandBack();
      }
      if (lastLiveSeenRef.current > 0 && Date.now() - lastLiveSeenRef.current > HEARTBEAT_STALE_MS) {
        setConnected(false);
        pairedLiveIdRef.current = null;
        failAllPending();
      }
    };
    tick();
    const intervalId = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    const handBack = () => {
      postPreparedHandBack();
    };
    window.addEventListener('pagehide', handBack);

    return () => {
      window.removeEventListener('pagehide', handBack);
      const shouldWaitForHandBack = pairedLiveIdRef.current !== null && privateKeyRef.current !== null;
      const postedPreparedHandBack = postPreparedHandBack();
      const handBackPromise = postedPreparedHandBack
        ? Promise.resolve()
        : postPayload({ kind: 'sidebar-handoff', action: 'reopen' });
      clearInterval(intervalId);
      unsubscribe();
      failAllPending();
      if (shouldWaitForHandBack && !postedPreparedHandBack) {
        void handBackPromise.finally(() => active.stop());
      } else {
        active.stop();
      }
    };
  }, [active, pairing, post, postPayload, postPreparedHandBack, refreshPreparedHandBack, sessionId]);

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
