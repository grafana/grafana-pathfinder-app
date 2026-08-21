/**
 * One gcx credential per sandbox session, shared by every surface that offers
 * to install it. Module-scoped rather than per-component: the guide step and
 * the terminal toolbar both offer the same install, and a second mint for a
 * session Grafana already holds a `coda-<sessionId>` token for is rejected on
 * the token name.
 */

import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { logger } from '../../lib/logging';
import { recordGcxCredentialDegradation } from '../../lib/telemetry';
import { codaErrorCodeMessage, isMintForbidden, provisionGcx, toCodaError, type GcxCredential } from './coda-api';

/** `needs-token` is "asked, and told to paste one instead". */
export type GcxState = 'idle' | 'provisioning' | 'ready' | 'needs-token' | 'failed';

export interface GcxSnapshot {
  /** The session the state describes, so a new VM cannot inherit it. */
  sessionId: string | null;
  state: GcxState;
  credential: GcxCredential | null;
  error: string | null;
}

const IDLE: GcxSnapshot = { sessionId: null, state: 'idle', credential: null, error: null };

let snapshot: GcxSnapshot = IDLE;
const listeners = new Set<() => void>();

function publish(next: GcxSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribeGcxCredential(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGcxCredentialSnapshot(): GcxSnapshot {
  return snapshot;
}

export function resetGcxCredential(): void {
  publish(IDLE);
}

/**
 * Forget a credential the session it was written to can no longer hold. A
 * reconnect provisions a fresh VM, so keeping the old state would report gcx as
 * ready for a box that no longer exists — and offer no way back to the form.
 *
 * A `null` id is a disconnect, which may still reconnect to the same session,
 * so it is not enough on its own to discard the state.
 */
export function invalidateGcxCredentialForSession(sessionId: string | null): void {
  if (sessionId && snapshot.sessionId && sessionId !== snapshot.sessionId) {
    resetGcxCredential();
  }
}

/**
 * Install a credential into `sessionId`, minting one unless `token` is given.
 * The session's terminal must already be connected; the backend has no other
 * route to the VM.
 */
export async function runGcxCredential(sessionId: string | null, token?: string): Promise<void> {
  if (!sessionId) {
    publish({ ...IDLE, state: 'failed', error: 'The sandbox is not connected, so gcx cannot be set up yet.' });
    return;
  }
  if (snapshot.state === 'provisioning') {
    return;
  }

  publish({ sessionId, state: 'provisioning', credential: null, error: null });
  try {
    const written = await provisionGcx(sessionId, token ? { token } : {});
    publish({ sessionId, state: 'ready', credential: written, error: null });
    reportAppInteraction(UserInteraction.GcxCredentialInstalled, { source: token ? 'pasted' : 'minted' });
  } catch (err) {
    const codaErr = toCodaError(err);
    if (isMintForbidden(codaErr)) {
      // Expected below Admin, so it reveals the paste field rather than
      // reporting a failure.
      publish({
        sessionId,
        state: 'needs-token',
        credential: null,
        error: 'Grafana would not let this account mint a token. Paste a service account token instead.',
      });
      recordGcxCredentialDegradation('mint-forbidden');
      return;
    }
    if (codaErr.code === 'session_not_found') {
      // The session connected moments ago, so it exists. A 404 on this route
      // means the route does not — and there is no capability flag to
      // feature-detect the credential route with.
      publish({
        sessionId,
        state: 'failed',
        credential: null,
        error: 'This Grafana’s Coda plugin is too old to install a gcx credential — it needs 1.3.0 or later.',
      });
      recordGcxCredentialDegradation('plugin-too-old');
      return;
    }
    logger.warn('[gcx] credential install failed', { code: codaErr.code });
    publish({
      sessionId,
      state: 'needs-token',
      credential: null,
      error: codaErrorCodeMessage(codaErr.code, codaErr.message),
    });
    recordGcxCredentialDegradation('refused');
  }
}
