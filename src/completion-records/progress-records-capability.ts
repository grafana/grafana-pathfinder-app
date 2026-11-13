import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom, timeout } from 'rxjs';

import { backendRoute } from '../lib/backend-routes';
import { logger } from '../lib/logging';
import { getUserScope } from '../lib/user-scope';
import { CompletionCapabilityWireSchema } from '../types/backend-api.schema';
import { getFeatureFlagValue } from '../utils/openfeature';

export type ProgressRecordsCapability = 'yes' | 'no' | 'unknown';

const FLAG_POLL_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

let capabilityScope = '';
let state: ProgressRecordsCapability = 'unknown';
let inflight: Promise<ProgressRecordsCapability> | null = null;

function syncCapabilityScope(): string {
  const scope = getUserScope();
  if (scope !== capabilityScope) {
    capabilityScope = scope;
    state = 'unknown';
    inflight = null;
  }
  return scope;
}

export function progressRecordsCapability(): ProgressRecordsCapability {
  syncCapabilityScope();
  return state;
}

async function fetchCapability(): Promise<ProgressRecordsCapability> {
  const response = await lastValueFrom(
    getBackendSrv()
      .fetch<unknown>({ url: backendRoute('completion-records/capability'), method: 'GET', showErrorAlert: false })
      .pipe(timeout(10_000))
  );
  const parsed = CompletionCapabilityWireSchema.safeParse(response.data);
  if (!parsed.success) {
    return 'unknown';
  }
  return parsed.data.available && parsed.data.progressRecords === true ? 'yes' : 'no';
}

export function loadProgressRecordsCapability(
  fetcher: () => Promise<ProgressRecordsCapability> = fetchCapability
): Promise<ProgressRecordsCapability> {
  const scope = syncCapabilityScope();
  if (!getFeatureFlagValue('pathfinder.progress-records', false)) {
    return Promise.resolve('unknown');
  }
  if (state !== 'unknown') {
    return Promise.resolve(state);
  }
  if (!inflight) {
    const request = Promise.resolve()
      .then(fetcher)
      .then((resolved) => {
        if (scope !== getUserScope()) {
          return 'unknown' as const;
        }
        state = resolved;
        return resolved;
      })
      .catch((error: unknown) => {
        logger.debug('progress records capability: request failed, staying unknown', { error: String(error) });
        return 'unknown' as const;
      })
      .finally(() => {
        if (inflight === request) {
          inflight = null;
        }
      });
    inflight = request;
  }
  return inflight;
}

/** Poll the local flag without network traffic until enabled, then retry unknown capability. */
export function watchProgressRecordsCapability(onResolved: () => void): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoff = 1_000;

  async function probe(): Promise<void> {
    if (disposed) {
      return;
    }
    if (!getFeatureFlagValue('pathfinder.progress-records', false)) {
      timer = setTimeout(() => void probe(), FLAG_POLL_MS);
      return;
    }
    const resolved = await loadProgressRecordsCapability();
    if (disposed) {
      return;
    }
    if (resolved !== 'unknown') {
      onResolved();
      return;
    }
    const delay = Math.min(MAX_BACKOFF_MS, Math.round(backoff * (0.75 + Math.random() * 0.5)));
    backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
    timer = setTimeout(() => void probe(), delay);
  }

  void probe();
  return () => {
    disposed = true;
    clearTimeout(timer);
  };
}

export function __setProgressRecordsCapabilityForTests(next: ProgressRecordsCapability): void {
  capabilityScope = getUserScope();
  state = next;
  inflight = null;
}

export function __resetProgressRecordsCapabilityForTests(): void {
  state = 'unknown';
  inflight = null;
}
