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
  CODA_PLUGIN_ID,
  CODA_RESOURCE_BASE,
  V1_DEFAULTS,
  isCodaUsable,
  codaSessionEligibility,
  type CodaErrorCode,
  type CodaCapabilities,
  type CodaSessionRole,
  type CreateSessionOptions,
  type ExecOptions,
  type ExecResult,
} from '@grafana/coda-client';

export {
  CodaError,
  toCodaError,
  isNotReady,
  isUnavailable,
  CODA_PLUGIN_ID,
  CODA_RESOURCE_BASE,
  V1_DEFAULTS,
  isCodaUsable,
  codaSessionEligibility,
};
export type { CodaErrorCode, CodaCapabilities, CodaSessionRole };

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

export function sampleAppsUrl(): string {
  return `${CODA_RESOURCE_BASE}/sample-apps`;
}

export function alloyScenariosUrl(): string {
  return `${CODA_RESOURCE_BASE}/alloy-scenarios`;
}
