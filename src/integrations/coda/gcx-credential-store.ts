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
import {
  codaErrorCodeMessage,
  isMintForbidden,
  provisionGcx,
  toCodaError,
  type GcxCredential,
  type MintTokenOptions,
} from './coda-api';
import {
  ACCOUNT_CHECK_UNAVAILABLE,
  ACCOUNT_OUTRANKS_CALLER,
  assertServiceAccountIsMintable,
  gcxServiceAccountName,
} from './gcx-service-account';

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

/**
 * Bumped by every reset and every run start, so an install that settles after
 * the terminal moved on cannot publish over its replacement.
 */
let generation = 0;

/**
 * Mints attempted against `mintSession`. Grafana rejects a duplicate token name
 * even once the first token has expired, so a retry — "Set up again", or a mint
 * whose delivery failed and discarded the only token value — has to ask for a
 * name nothing holds yet.
 */
let mintSession: string | null = null;
let mintAttempts = 0;

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

/**
 * Back to the form, keeping the mint bookkeeping. "Set up again" lands here,
 * and it is the same session — so the next mint still has to ask for a token
 * name the expired one does not hold.
 */
export function resetGcxCredential(): void {
  generation += 1;
  publish(IDLE);
}

/** Everything a page reload would have cleared, bookkeeping included. */
export function resetGcxCredentialStore(): void {
  mintSession = null;
  mintAttempts = 0;
  resetGcxCredential();
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

/** A token name no earlier mint for this session has claimed. */
function nextTokenName(sessionId: string): string {
  if (mintSession !== sessionId) {
    mintSession = sessionId;
    mintAttempts = 0;
  }
  mintAttempts += 1;
  return mintAttempts === 1 ? `coda-${sessionId}` : `coda-${sessionId}-${mintAttempts}`;
}

/**
 * Name the account and the token a mint may use. The account is checked before
 * the name is claimed, so a refusal does not burn a token name.
 */
async function mintOptions(sessionId: string): Promise<MintTokenOptions> {
  const serviceAccountName = gcxServiceAccountName();
  await assertServiceAccountIsMintable(serviceAccountName);
  return { serviceAccountName, tokenName: nextTokenName(sessionId) };
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

  generation += 1;
  const run = generation;
  publish({ sessionId, state: 'provisioning', credential: null, error: null });

  /**
   * Publish only while this run is still the one the UI is waiting for. A
   * reconnect resets the store and starts a new session, and an install that
   * was already in flight would otherwise report ready for a VM that never
   * received a credential.
   */
  const settle = (next: GcxSnapshot): boolean => {
    if (run !== generation || snapshot.sessionId !== sessionId) {
      logger.warn('[gcx] discarding a settled install for a session that has moved on');
      return false;
    }
    publish(next);
    return true;
  };

  try {
    const written = await provisionGcx(sessionId, token ? { token } : await mintOptions(sessionId));
    if (settle({ sessionId, state: 'ready', credential: written, error: null })) {
      reportAppInteraction(UserInteraction.GcxCredentialInstalled, { source: token ? 'pasted' : 'minted' });
    }
  } catch (err) {
    const codaErr = toCodaError(err);
    if (codaErr.code === ACCOUNT_OUTRANKS_CALLER) {
      // The one refusal an operator can clear, so it keeps its own sentence
      // rather than being folded into the generic mint refusal.
      const revealed = settle({ sessionId, state: 'needs-token', credential: null, error: codaErr.message });
      if (revealed) {
        recordGcxCredentialDegradation('account-outranks-caller');
      }
      return;
    }
    if (codaErr.code === ACCOUNT_CHECK_UNAVAILABLE) {
      // Not a refusal — the preflight reached no answer, so back to `idle` with
      // the mint still on offer rather than to the paste-only branch.
      const reported = settle({ sessionId, state: 'idle', credential: null, error: codaErr.message });
      if (reported) {
        recordGcxCredentialDegradation('account-check-unavailable');
      }
      return;
    }
    if (isMintForbidden(codaErr)) {
      // Expected below Admin, so it reveals the paste field rather than
      // reporting a failure.
      const revealed = settle({
        sessionId,
        state: 'needs-token',
        credential: null,
        error: 'Grafana would not let this account mint a token. Paste a service account token instead.',
      });
      if (revealed) {
        recordGcxCredentialDegradation('mint-forbidden');
      }
      return;
    }
    if (codaErr.code === 'session_not_found') {
      // The session connected moments ago, so it exists. A 404 on this route
      // means the route does not — and there is no capability flag to
      // feature-detect the credential route with.
      const reported = settle({
        sessionId,
        state: 'failed',
        credential: null,
        error: 'This Grafana’s Coda plugin is too old to install a gcx credential — it needs 1.3.0 or later.',
      });
      if (reported) {
        recordGcxCredentialDegradation('plugin-too-old');
      }
      return;
    }
    logger.warn('[gcx] credential install failed', { code: codaErr.code });
    const reported = settle({
      sessionId,
      state: 'needs-token',
      credential: null,
      error: codaErrorCodeMessage(codaErr.code, codaErr.message),
    });
    if (reported) {
      recordGcxCredentialDegradation('refused');
    }
  }
}
