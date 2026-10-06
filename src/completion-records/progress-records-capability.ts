/**
 * Whether the installed plugin backend accepts attempt upserts.
 *
 * Read once per session from `GET /completion-records/capability`
 * (`progressRecords: true`). Three states, because each one means something
 * different to the writer:
 *   - `yes`: new attempts may be minted in `records` mode and partials sent;
 *   - `no`: the backend cannot take partials (an older plugin, or the route is
 *     unavailable), so queued partials are dropped rather than retried;
 *   - `unknown`: not answered yet, or the request failed. Nothing is minted in
 *     `records` mode, and queued partials wait.
 */

import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { PLUGIN_BACKEND_URL } from '../constants';
import { logger } from '../lib/logging';
import { CompletionCapabilityWireSchema } from '../types/backend-api.schema';

export type ProgressRecordsCapability = 'yes' | 'no' | 'unknown';

const CAPABILITY_URL = `${PLUGIN_BACKEND_URL}/completion-records/capability`;

let state: ProgressRecordsCapability = 'unknown';
let inflight: Promise<ProgressRecordsCapability> | null = null;
const listeners = new Set<(state: ProgressRecordsCapability) => void>();

export function progressRecordsCapability(): ProgressRecordsCapability {
  return state;
}

/** Called once the capability resolves to `yes` or `no`. */
export function onProgressRecordsCapabilityResolved(listener: (state: ProgressRecordsCapability) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function fetchCapability(): Promise<ProgressRecordsCapability> {
  const response = await lastValueFrom(
    getBackendSrv().fetch<unknown>({ url: CAPABILITY_URL, method: 'GET', showErrorAlert: false })
  );
  const parsed = CompletionCapabilityWireSchema.safeParse(response.data);
  if (!parsed.success) {
    return 'no';
  }
  return parsed.data.available && parsed.data.progressRecords === true ? 'yes' : 'no';
}

/**
 * Resolve the capability once per session. A failed request leaves it
 * `unknown`, so a later call can try again; it never throws.
 */
export function loadProgressRecordsCapability(
  fetcher: () => Promise<ProgressRecordsCapability> = fetchCapability
): Promise<ProgressRecordsCapability> {
  if (state !== 'unknown') {
    return Promise.resolve(state);
  }
  if (!inflight) {
    inflight = fetcher()
      .then((resolved) => {
        state = resolved;
        for (const listener of listeners) {
          try {
            listener(resolved);
          } catch (error) {
            logger.warn('progress records capability: listener threw', { error: String(error) });
          }
        }
        return resolved;
      })
      .catch((error: unknown) => {
        logger.debug('progress records capability: request failed, staying unknown', { error: String(error) });
        return 'unknown' as const;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function __setProgressRecordsCapabilityForTests(next: ProgressRecordsCapability): void {
  state = next;
  inflight = null;
}

export function __resetProgressRecordsCapabilityForTests(): void {
  state = 'unknown';
  inflight = null;
  listeners.clear();
}
