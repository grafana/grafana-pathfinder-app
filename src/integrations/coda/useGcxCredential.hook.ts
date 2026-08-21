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

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

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
 * @param onReady called once per installed credential, whichever surface
 *   installed it. The step uses it to mark itself complete; the toolbar has
 *   nothing to do and omits it.
 */
export function useGcxCredential(onReady?: (credential: GcxCredential) => void): UseGcxCredentialResult {
  const snapshot = useSyncExternalStore(subscribeGcxCredential, getGcxCredentialSnapshot);

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const notifiedRef = useRef<GcxCredential | null>(null);
  useEffect(() => {
    if (snapshot.state !== 'ready' || !snapshot.credential || notifiedRef.current === snapshot.credential) {
      return;
    }
    notifiedRef.current = snapshot.credential;
    onReadyRef.current?.(snapshot.credential);
  }, [snapshot.state, snapshot.credential]);

  const run = useCallback((sessionId: string | null, token?: string) => runGcxCredential(sessionId, token), []);
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
