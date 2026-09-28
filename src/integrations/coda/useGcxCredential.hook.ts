/**
 * Installing a Grafana credential into a sandbox VM, so the `gcx` CLI that
 * ships in every image can talk to this Grafana as the learner.
 *
 * Lives in `integrations/` because `TerminalPanel` (tier 3) cannot import from
 * `components/` (tier 4), while `terminal-connect-step` (tier 4) can import
 * from here.
 *
 * State lives in `gcx-credential-store`, not in the component, so the guide
 * step and the terminal toolbar agree on whether this session already has a
 * credential. See `docs/developer/CODA.md` for why minting happens in the
 * browser and why a pasted token is the primary path, not a fallback.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { canMintGrafanaToken, type GcxCredential } from './coda-api';
import {
  getGcxCredentialSnapshot,
  resetGcxCredential,
  runGcxCredential,
  subscribeGcxCredential,
  type GcxState,
} from './gcx-credential-store';

export type { GcxState };

export interface UseGcxCredentialResult {
  state: GcxState;
  credential: GcxCredential | null;
  error: string | null;
  /** Whether a mint has yet to be tried or refused for this session. */
  offerMint: boolean;
  /** A role hint for how prominently to offer minting, not an authorisation answer. */
  mintLikely: boolean;
  /** True until a credential is installed — callers gate completion on this. */
  isPending: boolean;
  run: (sessionId: string | null, token?: string) => Promise<void>;
  reset: () => void;
}

/**
 * @param onReady called once when this hook's requester installs a credential.
 *   A gcx step uses it to mark itself complete; the terminal toolbar has no
 *   requester and omits it. Readiness remains shared by session, but completion
 *   never belongs to a sibling step that did not start the run.
 * @param sessionId the session this caller is asking about. Everything the hook
 *   reports describes that session and nothing else: a credential belongs to
 *   the VM it was written into, so an unrelated step must not read one, render
 *   it, or complete on it.
 * @param requesterId stable identity for the step that may complete. Omit it for
 *   session-level surfaces such as the terminal toolbar.
 */
export function useGcxCredential(
  onReady?: (credential: GcxCredential) => void,
  sessionId: string | null = null,
  requesterId: string | null = null
): UseGcxCredentialResult {
  const stored = useSyncExternalStore(subscribeGcxCredential, getGcxCredentialSnapshot);
  const snapshot = useMemo(
    () =>
      stored.sessionId === sessionId
        ? stored
        : { sessionId, requesterId: null, state: 'idle' as GcxState, credential: null, error: null },
    [stored, sessionId]
  );

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const notifiedRef = useRef<GcxCredential | null>(null);
  useEffect(() => {
    if (
      snapshot.state !== 'ready' ||
      !snapshot.credential ||
      requesterId === null ||
      snapshot.requesterId !== requesterId ||
      notifiedRef.current === snapshot.credential
    ) {
      return;
    }
    notifiedRef.current = snapshot.credential;
    onReadyRef.current?.(snapshot.credential);
  }, [snapshot.state, snapshot.credential, snapshot.requesterId, requesterId]);

  const run = useCallback(
    (target: string | null, token?: string) => runGcxCredential(target, token, requesterId),
    [requesterId]
  );
  const reset = useCallback(() => resetGcxCredential(), []);

  return {
    state: snapshot.state,
    credential: snapshot.credential,
    error: snapshot.error,
    offerMint: snapshot.state === 'idle',
    mintLikely: canMintGrafanaToken(),
    isPending: snapshot.state !== 'ready',
    run,
    reset,
  };
}
