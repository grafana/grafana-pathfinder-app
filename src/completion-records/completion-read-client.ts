import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom, timeout } from 'rxjs';

import { PLUGIN_BACKEND_URL } from '../constants';
import { logger } from '../lib/logging';
import { MyCompletionsResponseWireSchema, type MyCompletionsResponseWire } from '../types/backend-api.schema';
import { onCompletionPublished } from './completion-write-hook';

export type MyCompletionsResult =
  { kind: 'ok'; data: MyCompletionsResponseWire } | { kind: 'unavailable' } | { kind: 'invalid' };

const MY_COMPLETIONS_URL = `${PLUGIN_BACKEND_URL}/completion-records/my`;
const TRANSPORT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

let cached: { result: Extract<MyCompletionsResult, { kind: 'ok' }>; fetchedAt: number } | null = null;
let inflight: Promise<MyCompletionsResult> | null = null;
// The backend answered available:false: a standing condition, so it is not re-probed until reload or a clear.
let structurallyUnavailable = false;
// A clear during a load must stop that load from re-populating the cache with pre-clear data.
let generation = 0;
let unsubscribe: (() => void) | null = null;

interface Fetched {
  result: MyCompletionsResult;
  structural: boolean;
}

async function fetchMyCompletions(): Promise<Fetched> {
  try {
    const response = await lastValueFrom(
      getBackendSrv()
        .fetch<unknown>({ url: MY_COMPLETIONS_URL, method: 'GET', showErrorAlert: false })
        .pipe(timeout(TRANSPORT_TIMEOUT_MS))
    );
    const parsed = MyCompletionsResponseWireSchema.safeParse(response.data);
    if (!parsed.success) {
      return { result: { kind: 'invalid' }, structural: false };
    }
    return parsed.data.capability.available
      ? { result: { kind: 'ok', data: parsed.data }, structural: false }
      : { result: { kind: 'unavailable' }, structural: true };
  } catch {
    return { result: { kind: 'unavailable' }, structural: false };
  }
}

export function loadMyCompletions(): Promise<MyCompletionsResult> {
  unsubscribe ??= onCompletionPublished(clearMyCompletionsCache);
  if (structurallyUnavailable) {
    return Promise.resolve({ kind: 'unavailable' });
  }
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cached.result);
  }
  if (!inflight) {
    const startedIn = generation;
    const request: Promise<MyCompletionsResult> = fetchMyCompletions()
      .then(({ result, structural }) => {
        if (startedIn === generation) {
          if (result.kind === 'ok') {
            cached = { result, fetchedAt: Date.now() };
          } else if (structural) {
            structurallyUnavailable = true;
          }
        }
        logger.debug('my completions: load finished', { outcome: result.kind });
        return result;
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

export function clearMyCompletionsCache(): void {
  generation++;
  cached = null;
  structurallyUnavailable = false;
  inflight = null;
}

export function __resetMyCompletionsCacheForTests(): void {
  clearMyCompletionsCache();
  unsubscribe?.();
  unsubscribe = null;
}
