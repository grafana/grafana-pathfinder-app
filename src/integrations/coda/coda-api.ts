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
}

export interface ExecRequest {
  command: string;
  mode?: 'raw' | 'gated';
  timeoutMs?: number;
}

export interface ExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  truncated?: boolean;
}

/**
 * Reserves a session and returns the Live channel to subscribe to. VM
 * provisioning happens after subscribe, so this resolves immediately.
 */
export async function createSession(vmOpts?: TerminalVMOptions): Promise<CodaSession> {
  const response = getBackendSrv().fetch<CodaSession>({
    url: `${CODA_BACKEND_URL}/sessions`,
    method: 'POST',
    data: {
      template: vmOpts?.template || undefined,
      app: vmOpts?.app || undefined,
      scenario: vmOpts?.scenario || undefined,
    },
    showErrorAlert: false,
  });
  return (await lastValueFrom(response)).data;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = getBackendSrv().fetch({
    url: `${CODA_BACKEND_URL}/sessions/${encodeURIComponent(sessionId)}`,
    method: 'DELETE',
    showErrorAlert: false,
  });
  await lastValueFrom(response);
}

export async function execInSession(sessionId: string, req: ExecRequest): Promise<ExecResponse> {
  const response = getBackendSrv().fetch<ExecResponse>({
    url: `${CODA_BACKEND_URL}/sessions/${encodeURIComponent(sessionId)}/exec`,
    method: 'POST',
    data: req,
    showErrorAlert: false,
  });
  return (await lastValueFrom(response)).data;
}

export async function getCapabilities(): Promise<CodaCapabilities> {
  const response = getBackendSrv().fetch<CodaCapabilities>({
    url: `${CODA_BACKEND_URL}/capabilities`,
    method: 'GET',
    showErrorAlert: false,
  });
  return (await lastValueFrom(response)).data;
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
