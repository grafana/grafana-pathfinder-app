/**
 * Installing a Grafana credential into a sandbox VM, so the `gcx` CLI that
 * ships in every image can talk to this Grafana as the learner.
 *
 * Lives in `integrations/` rather than `components/` because both consumers
 * need it and one of them is in this tier: `TerminalPanel` (tier 3) cannot
 * import from `components/` (tier 4), but `terminal-connect-step` (tier 4) can
 * import from here. See `src/validation/import-graph.ts`.
 *
 * **Minting happens in the browser and cannot move into the plugin.** Grafana
 * refuses to create a service account whose role exceeds the caller's own, and
 * a plugin's managed service account has no basic role at all, so the backend
 * can mint nothing usable — by design. Doing it here with the user's own
 * session satisfies that guard by construction.
 *
 * **`serviceaccounts:create` is Admin-only by default while sandbox sessions
 * are open to Editors**, so `mint_forbidden` is the ordinary answer, not an
 * error. Callers must always offer the pasted-token path.
 */

import { useCallback, useState } from 'react';

import {
  canMintGrafanaToken,
  codaErrorCodeMessage,
  isMintForbidden,
  provisionGcx,
  toCodaError,
  type GcxCredential,
} from './coda-api';
import { logger } from '../../lib/logging';

/**
 * `idle` is "not asked for yet"; `needs-token` is "asked, and Grafana or the
 * backend said to paste one instead"; `failed` is a dead end for this session.
 */
export type GcxState = 'idle' | 'provisioning' | 'ready' | 'needs-token' | 'failed';

export interface UseGcxCredentialResult {
  state: GcxState;
  credential: GcxCredential | null;
  error: string | null;
  /** Whether to offer minting first. A hint, not an authorisation check. */
  canMint: boolean;
  /** True until a credential is installed — callers gate completion on this. */
  isPending: boolean;
  /**
   * Install a credential into `sessionId`. Pass `token` to use one the user
   * supplied rather than minting. The session's terminal must already be
   * connected; the backend has no other route to the VM.
   */
  run: (sessionId: string | null, token?: string) => Promise<void>;
  reset: () => void;
}

/**
 * @param onReady called once a credential is installed. The step uses it to
 *   mark itself complete; the toolbar has nothing to do and omits it. Injected
 *   rather than assumed, so this hook carries no step semantics.
 */
export function useGcxCredential(onReady?: (credential: GcxCredential) => void): UseGcxCredentialResult {
  const [state, setState] = useState<GcxState>('idle');
  const [credential, setCredential] = useState<GcxCredential | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (sessionId: string | null, token?: string) => {
      if (!sessionId) {
        setState('failed');
        setError('The sandbox is not connected, so gcx cannot be set up yet.');
        return;
      }

      setState('provisioning');
      setError(null);
      try {
        const written = await provisionGcx(sessionId, token ? { token } : {});
        setCredential(written);
        setState('ready');
        onReady?.(written);
      } catch (err) {
        const codaErr = toCodaError(err);
        if (isMintForbidden(codaErr)) {
          // Expected below Admin, so it reveals the paste field rather than
          // reporting a failure.
          setState('needs-token');
          setError('Grafana would not let this account mint a token. Paste a service account token instead.');
          return;
        }
        if (codaErr.code === 'session_not_found') {
          // The session connected moments ago, so it exists. A 404 on this
          // route means the route does not — and there is no capability flag to
          // feature-detect the credential route with.
          setState('failed');
          setError('This Grafana’s Coda plugin is too old to install a gcx credential — it needs 1.3.0 or later.');
          return;
        }
        logger.warn('[gcx] credential install failed', { code: codaErr.code });
        setState('needs-token');
        setError(codaErrorCodeMessage(codaErr.code, codaErr.message));
      }
    },
    [onReady]
  );

  const reset = useCallback(() => {
    setState('idle');
    setCredential(null);
    setError(null);
  }, []);

  return {
    state,
    credential,
    error,
    canMint: state === 'idle' && canMintGrafanaToken(),
    isPending: state !== 'ready',
    run,
    reset,
  };
}
