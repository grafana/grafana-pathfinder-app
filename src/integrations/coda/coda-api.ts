/**
 * TEMPORARY local client for the `grafana-coda-app` v1 API.
 *
 * ---------------------------------------------------------------------------
 * TODO (on or after 2026-08-15): delete this file and depend on the published
 * package instead.
 *
 * It is published as **`@grafana-coda/sandbox-client@1.1.1`** — an interim
 * scope, so it is consumed through an npm alias that keeps the import
 * specifier this file will be replaced by:
 *
 *   "@grafana/coda-client": "npm:@grafana-coda/sandbox-client@^1.1.1"
 *
 * The one thing blocking that line today is our own `.npmrc`:
 * `min-release-age=3` refuses any version published less than three days ago,
 * and 1.1.1 went out at **2026-08-12T15:26:59Z**, so `npm ci` rejects it until
 * **2026-08-15T15:26:59Z**. Adding the dependency before then makes the repo
 * uninstallable, which is why the hand copy is still here.
 *
 * The package is a superset of this file: it also owns the Grafana Live
 * protocol — frame unwrapping, the mandatory `{ useSocket: true }` publish, and
 * a one-shot session object that cannot be left subscribed after an error.
 *
 * The swap is:
 *   - replace this file with re-exports from `@grafana/coda-client`;
 *   - move `useTerminalLive.hook.ts` onto its `CodaSession` class, which
 *     deletes the frame parsing, channel splitting, `publishOverSocket` cast
 *     and handshake timer that still live there;
 *   - note that `CodaSession` in the package is that class, not this response
 *     interface — the package calls this shape `SessionResponse`.
 *
 * Names below deliberately match the package so that diff stays small.
 * ---------------------------------------------------------------------------
 */

import { getBackendSrv } from '@grafana/runtime';
import { LiveChannelScope, type LiveChannelAddress } from '@grafana/data';
import { lastValueFrom } from 'rxjs';

export const CODA_PLUGIN_ID = 'grafana-coda-app';

const CODA_BACKEND_URL = `/api/plugins/${CODA_PLUGIN_ID}/resources/v1`;

export interface TerminalVMOptions {
  template?: string;
  app?: string;
  scenario?: string;
}

export interface CodaSession {
  sessionId: string;
  channel: string;
  state: string;
  vmId?: string;
  template: string;
}

export interface CodaCatalogueItem {
  id: string;
  name: string;
  description: string;
}

/**
 * Facts about the backend that would otherwise be hardcoded here. Optional
 * because an older Coda plugin does not send them — fall back to
 * {@link V1_DEFAULTS} rather than requiring anything it has not advertised.
 */
export interface CodaTimings {
  heartbeatIntervalMs: number;
  estimatedProvisionMs: number;
  maxProvisionMs: number;
}

/**
 * Whether the credential the *backend* holds still works.
 *
 * `registered` cannot answer this: it means a credential was obtained and
 * stored, which stays true of a refresh token that expired 90 days ago while
 * every call 401s. `unknown` means nothing has exercised it yet and
 * `unreachable` is a statement about Coda rather than the token — both are
 * absent evidence, not evidence of a dead credential.
 */
export type CodaCredentialState = 'unknown' | 'ok' | 'expired' | 'unreachable' | (string & {});

export interface CodaCredentialHealth {
  state: CodaCredentialState;
  /** RFC 3339. Absent while `unknown`. */
  checkedAt?: string;
}

/** A Grafana basic role. Open because the vocabulary is Grafana's, not ours. */
export type CodaSessionRole = 'Viewer' | 'Editor' | 'Admin' | (string & {});

/** A behaviour-changing *input* the backend advertises honouring. */
export type CodaFeature = 'exec.readyFile' | (string & {});

export interface CodaCallerCapabilities {
  /**
   * Whether this caller's Grafana basic role meets the floor for spending VM
   * quota — the same check `POST /v1/sessions` and exec enforce, so `false`
   * means those calls would answer `403 role_forbidden`.
   */
  canCreateSessions: boolean;
  /**
   * The effective floor, for writing the message ("needs Editor or above").
   * Not for deciding: the backend sees only the basic role and RBAC cannot
   * grant past it, so ranking roles here would reimplement the one thing
   * {@link canCreateSessions} exists to settle.
   */
  minimumSessionRole: CodaSessionRole;
}

export interface CodaCapabilities {
  registered: boolean;
  templates: CodaCatalogueItem[];
  sampleApps: CodaCatalogueItem[];
  alloyScenarios: CodaCatalogueItem[];
  limits: {
    maxVMsPerUser: number;
    maxExecTimeoutMs: number;
    maxOutputBytes: number;
  };
  apiVersions?: string[];
  pluginVersion?: string;
  timings?: CodaTimings;
  readyGate?: { defaultPath: string };
  /** Absent on a backend older than the release that added the list. */
  features?: CodaFeature[];
  /**
   * The only per-caller part of this response: never share it between users.
   * Absent on an older backend — read it through {@link codaSessionEligibility}.
   */
  caller?: CodaCallerCapabilities;
  credential?: CodaCredentialHealth;
  /** Problems with the backend's own configuration that stop registration. */
  configErrors?: string[];
}

/**
 * Whether Coda can actually be used, as opposed to merely being registered.
 *
 * Read this rather than `registered` alone: reading `registered` is how a green
 * "Coda is ready" came to be rendered on a stack that 401s on every session.
 *
 * Absent fields mean an older backend, so they count as "no evidence of a
 * problem" — that is the additive rule this API works by, and it keeps this no
 * stricter than `registered` was against a backend that cannot answer.
 */
export function isCodaUsable(capabilities: CodaCapabilities): boolean {
  return (
    capabilities.registered &&
    capabilities.credential?.state !== 'expired' &&
    (capabilities.configErrors?.length ?? 0) === 0
  );
}

/**
 * Whether the caller may start a session, as a three-state answer.
 *
 * `unknown` means the backend predates the field. Attempt the call and handle
 * the `403` — do not assume either answer, which would hide the sandbox from
 * someone entitled to it or offer it to someone who cannot have it.
 */
export type CodaSessionEligibility = 'eligible' | 'role_forbidden' | 'unknown' | (string & {});

export function codaSessionEligibility(capabilities: CodaCapabilities): CodaSessionEligibility {
  if (!capabilities.caller) {
    return 'unknown';
  }
  return capabilities.caller.canCreateSessions ? 'eligible' : 'role_forbidden';
}

/**
 * The ready gate Pathfinder's challenge blocks use.
 *
 * Ours to choose, now that the backend takes a `readyFile` per exec rather
 * than hardcoding one: two consumers sharing a path would race each other.
 * The value keeps the Coda plugin's historical default so existing guides that
 * write the file by hand keep working, but it is no longer *their* constant —
 * the coupling that used to exist between this literal and a Go `const` is
 * gone. Both the setup write and the `coda-exit-zero` check read it from here.
 */
export const PATHFINDER_READY_FILE = '/tmp/pathfinder-ready';

/** How a v1 backend behaved before it advertised the fields above. */
export const V1_DEFAULTS = {
  heartbeatIntervalMs: 3000,
  estimatedProvisionMs: 55_000,
  maxProvisionMs: 180_000,
  readyGateDefaultPath: '/tmp/pathfinder-ready',
} as const;

export interface ExecRequest {
  command: string;
  /**
   * Absolute path. When set, the command runs only once that file exists on
   * the VM, so a "check my work" click cannot evaluate a criterion before
   * setup has finished. A UI-race guard, not a security boundary — the learner
   * has a root shell on the same VM and can create it themselves.
   */
  readyFile?: string;
  timeoutMs?: number;
}

export interface ExecResponse {
  stdout: string;
  stderr: string;
  /** -1 means the shell closed without reporting status. Never read as a pass. */
  exitCode: number;
  durationMs: number;
  truncated?: boolean;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Codes from the backend's closed set. Open-ended on purpose: new ones can
 * appear within v1, and an unrecognised code must fall back to the status
 * rather than being treated as fatal.
 */
export type CodaErrorCode =
  | 'invalid_request'
  | 'invalid_ready_file'
  | 'conflicting_gate'
  | 'no_user'
  | 'coda_auth_failed'
  | 'admin_required'
  | 'role_forbidden'
  | 'session_not_found'
  | 'vm_not_found'
  | 'terminal_not_connected'
  | 'terminal_disconnected'
  | 'rate_limited'
  | 'vm_quota_exceeded'
  | 'coda_not_registered'
  | 'coda_unavailable'
  | 'upstream_failed'
  | 'exec_failed'
  | 'internal'
  /** Synthesised here when the plugin itself is absent or disabled. */
  | 'plugin_not_installed'
  | (string & {});

export class CodaError extends Error {
  readonly code: CodaErrorCode;
  readonly status: number;

  constructor(message: string, code: CodaErrorCode, status: number) {
    super(message);
    this.name = 'CodaError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Normalises a `getBackendSrv` rejection into a CodaError.
 *
 * A 404 is the one genuinely ambiguous status: the backend always sends a
 * code, so a 404 without one did not come from the backend at all — the plugin
 * is absent.
 */
export function toCodaError(err: unknown): CodaError {
  if (err instanceof CodaError) {
    return err;
  }
  const e = (err ?? {}) as { status?: number; data?: { error?: string; code?: string }; message?: string };
  const status = typeof e.status === 'number' ? e.status : 0;

  let code: CodaErrorCode;
  if (e.data?.code) {
    code = e.data.code;
  } else if (status === 404) {
    code = 'plugin_not_installed';
  } else if (status === 503) {
    code = 'coda_not_registered';
  } else {
    code = 'internal';
  }

  const message =
    e.data?.error ??
    (code === 'plugin_not_installed'
      ? 'The Coda app plugin is not installed or not enabled in this Grafana instance.'
      : (e.message ?? 'Could not reach the Coda plugin'));

  return new CodaError(message, code, status);
}

/**
 * The sandbox is not usable yet, or is no longer, but the request was fine.
 * `terminal_not_connected` resolves by waiting; the other two need a new
 * session.
 */
export function isNotReady(err: unknown): boolean {
  const { code } = toCodaError(err);
  return code === 'terminal_not_connected' || code === 'terminal_disconnected' || code === 'session_not_found';
}

/** Coda cannot serve anyone right now: hide the feature rather than retrying. */
export function isUnavailable(err: unknown): boolean {
  const { code } = toCodaError(err);
  return code === 'plugin_not_installed' || code === 'coda_not_registered';
}

/**
 * The user's Grafana role is too low to spend VM quota. Distinct from
 * unavailable: Coda is working, this person may not use it. An operator can
 * lower the floor with `minimumSessionRole` on the Coda plugin.
 */
export function isRoleForbidden(err: unknown): boolean {
  return toCodaError(err).code === 'role_forbidden';
}

// ─── Requests ────────────────────────────────────────────────────────────────

async function request<T>(method: string, path: string, data?: unknown): Promise<T> {
  try {
    const response = getBackendSrv().fetch<T>({
      url: `${CODA_BACKEND_URL}${path}`,
      method,
      data,
      // Callers surface failures in place; a global toast on top of an
      // in-context message is noise.
      showErrorAlert: false,
      // The plugin answers 401 `coda_auth_failed` when its own Coda credential
      // has expired. Grafana's global handler reads any first-attempt 401 on a
      // relative URL as the *caller's* session expiring, so it pings
      // /api/login/ping and replays the request. `retry: 1` opts out.
      retry: 1,
    });
    return (await lastValueFrom(response)).data;
  } catch (err) {
    throw toCodaError(err);
  }
}

/**
 * Reserves a session and returns the Live channel to subscribe to. VM
 * provisioning happens after subscribe, so this resolves immediately.
 */
export function createSession(vmOpts?: TerminalVMOptions): Promise<CodaSession> {
  return request<CodaSession>('POST', '/sessions', {
    template: vmOpts?.template || undefined,
    app: vmOpts?.app || undefined,
    scenario: vmOpts?.scenario || undefined,
  });
}

export function deleteSession(sessionId: string): Promise<void> {
  return request<void>('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
}

export function execInSession(sessionId: string, req: ExecRequest): Promise<ExecResponse> {
  return request<ExecResponse>('POST', `/sessions/${encodeURIComponent(sessionId)}/exec`, req);
}

export function getCapabilities(): Promise<CodaCapabilities> {
  return request<CodaCapabilities>('GET', '/capabilities');
}

export function sampleAppsUrl(): string {
  return `${CODA_BACKEND_URL}/sample-apps`;
}

export function alloyScenariosUrl(): string {
  return `${CODA_BACKEND_URL}/alloy-scenarios`;
}

/**
 * Splits the backend's `plugin/{id}/{path}` channel string into a Live address.
 * The path is opaque to the client — only the backend defines its shape.
 */
export function sessionChannelAddress(channel: string): LiveChannelAddress {
  const [scope, stream, ...pathParts] = channel.split('/');
  if (scope !== 'plugin' || !stream || pathParts.length === 0) {
    throw new Error(`Unexpected Coda channel address: ${channel}`);
  }
  return {
    scope: LiveChannelScope.Plugin,
    stream,
    path: pathParts.join('/'),
  };
}
