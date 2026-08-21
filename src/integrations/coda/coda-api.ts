/**
 * Thin adapter over the published `@grafana/coda-client` SDK.
 *
 * Consumers in this repo keep importing from here rather than from the
 * package directly, so the free-function call shapes this codebase already
 * uses (`getCapabilities()`, `createSession(vmOpts)`, `execInSession(id, req)`,
 * ...) stay unchanged even though the package itself is a `CodaClient` class
 * with instance methods. `client` below is the one shared instance.
 *
 * `createSession()` below resolves to the package's own `CodaSession` — the
 * *live terminal session* class (`subscribe`/`write`/`resize`/`exec`/`close`),
 * not a plain response object. `useTerminalLive.hook.ts` imports that type
 * directly from `@grafana/coda-client` rather than through this adapter.
 */

import {
  CodaClient,
  CodaError,
  toCodaError,
  isNotReady,
  isUnavailable,
  canMintGrafanaToken,
  provisionGcxCredential,
  CODA_PLUGIN_ID,
  V1_DEFAULTS,
  isCodaUsable,
  codaSessionEligibility,
  type CatalogueItem,
  type CodaErrorCode,
  type CodaCapabilities,
  type CodaSessionRole,
  type CreateSessionOptions,
  type ExecOptions,
  type ExecResult,
  type GcxCredential,
  type MintTokenOptions,
} from '@grafana/coda-client';

export {
  CodaError,
  toCodaError,
  isNotReady,
  isUnavailable,
  canMintGrafanaToken,
  CODA_PLUGIN_ID,
  V1_DEFAULTS,
  isCodaUsable,
  codaSessionEligibility,
};
export type { CatalogueItem, CodaErrorCode, CodaCapabilities, CodaSessionRole, GcxCredential, MintTokenOptions };

export type TerminalVMOptions = CreateSessionOptions;
export type ExecRequest = ExecOptions & { command: string };
export type ExecResponse = ExecResult;

/**
 * The ready gate Pathfinder's challenge blocks use.
 *
 * Ours to choose, now that the backend takes a `readyFile` per exec rather
 * than hardcoding one: two consumers sharing a path would race each other.
 * The value keeps the Coda plugin's historical default so existing guides that
 * write the file by hand keep working, but it is no longer *their* constant —
 * the coupling that used to exist between this literal and a Go `const` is
 * gone. Both the setup write and the `coda-exit-zero` check read it from here.
 * Not part of the SDK: it's a Pathfinder convention, not an API contract.
 */
export const PATHFINDER_READY_FILE = '/tmp/pathfinder-ready';

/**
 * The user's Grafana role is too low to spend VM quota. Distinct from
 * unavailable: Coda is working, this person may not use it. An operator can
 * lower the floor with `minimumSessionRole` on the Coda plugin.
 *
 * Not exported by the package — kept here rather than upstreamed for a
 * single-caller predicate.
 */
export function isRoleForbidden(err: unknown): boolean {
  return toCodaError(err).code === 'role_forbidden';
}

/**
 * Grafana declined the mint — not a fault, and not `role_forbidden`. The
 * expected answer below Admin, so branch to a pasted token. The code is
 * synthesised by the client, never sent by the Coda backend.
 */
export function isMintForbidden(err: unknown): boolean {
  return toCodaError(err).code === 'mint_forbidden';
}

/**
 * The one refusal sentence for a role too low to spend VM quota.
 *
 * `minimumSessionRole` is the only actionable fact in it — without the floor
 * named, a learner on Viewer cannot tell whether to ask for Editor or for the
 * plugin setting to be lowered. It is optional because only `/capabilities`
 * carries it: an error-code path has the refusal but not the floor.
 */
export function codaRoleForbiddenMessage(minimumSessionRole?: CodaSessionRole): string {
  const floor = minimumSessionRole ? `it needs ${minimumSessionRole} or above` : 'it needs a higher role';
  return `Your Grafana role does not allow starting a sandbox — ${floor}. Ask an administrator for that role, or to lower minimumSessionRole on the Coda plugin.`;
}

/**
 * The canonical sentence for a backend error code, shared by every consumer.
 *
 * The sandbox backend is a separate plugin, so "not installed", "not
 * registered" and "your role is too low" are all normal states needing distinct
 * guidance, and they are only distinguishable by the code — the plugin returns
 * several different failures per status. Kept here rather than per-consumer so
 * the same failure does not reach a learner worded three ways.
 *
 * `fallback` is the backend's own sentence: an unrecognised code (new ones are
 * an additive change within v1) and an absent one (an older backend) both land
 * there rather than being fatal.
 */
export function codaErrorCodeMessage(code: CodaErrorCode | undefined, fallback: string): string {
  switch (code) {
    case 'plugin_not_installed':
      return 'The Coda app plugin is not installed or not enabled in this Grafana instance.';
    case 'coda_not_registered':
      return 'Coda is not registered. An administrator must complete registration.';
    case 'coda_auth_failed':
      return 'Coda rejected the Coda app plugin’s credential. An administrator must register it again.';
    case 'role_forbidden':
      return codaRoleForbiddenMessage();
    case 'vm_quota_exceeded':
      // Deliberately does not say "close another terminal": CodaSession.close()
      // releases the terminal but leaves the VM holding its quota slot, so only
      // expiry or an operator-side delete frees one.
      return 'You already have the maximum number of sandbox VMs. Wait for one to expire before starting another.';
    case 'rate_limited':
      return 'Too many sandbox requests. Wait a moment and try again.';
    case 'mint_forbidden':
      return 'Grafana did not allow this account to create a service account token. Paste one instead.';
    case 'invalid_token':
      return 'That does not look like a usable Grafana service account token.';
    case 'credential_write_failed':
      return 'The credential could not be written into the sandbox VM. Try again.';
    case 'terminal_disconnected':
      return 'The sandbox VM is no longer connected. Connect again to start a new session.';
    case 'coda_unavailable':
    case 'upstream_failed':
      return 'The sandbox service could not be reached. Wait a moment and try again.';
    default:
      return fallback;
  }
}

const client = new CodaClient();

export function getCapabilities() {
  return client.getCapabilities();
}

/**
 * Reserves a session and returns it unsubscribed. Subscribing (in
 * `useTerminalLive.hook.ts`) is what starts VM provisioning.
 */
export function createSession(vmOpts?: TerminalVMOptions) {
  return client.createSession(vmOpts);
}

export function deleteSession(sessionId: string) {
  return client.deleteSession(sessionId);
}

/** Re-joins `req.command` with the rest of the options for `CodaClient.exec`. */
export function execInSession(sessionId: string, req: ExecRequest) {
  const { command, ...options } = req;
  return client.exec(sessionId, command, options);
}

/**
 * Give a session's VM a Grafana credential for the `gcx` CLI. Wrapped here
 * because `provisionGcxCredential` takes the client and this module owns the
 * only instance. The session's terminal must already be connected — the backend
 * has no other route to the box and answers 409 before then.
 */
export function provisionGcx(sessionId: string, options: MintTokenOptions & { token?: string } = {}) {
  return provisionGcxCredential(client, sessionId, options);
}
