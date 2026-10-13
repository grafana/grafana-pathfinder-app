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
// A clear during a load must stop that load from re-populating the cache with pre-clear data.
let generation = 0;
let unsubscribe: (() => void) | null = null;

async function fetchMyCompletions(): Promise<MyCompletionsResult> {
  try {
    const response = await lastValueFrom(
      getBackendSrv()
        .fetch<unknown>({ url: MY_COMPLETIONS_URL, method: 'GET', showErrorAlert: false })
        .pipe(timeout(TRANSPORT_TIMEOUT_MS))
    );
    const parsed = MyCompletionsResponseWireSchema.safeParse(response.data);
    if (!parsed.success) {
      return { kind: 'invalid' };
    }
    return parsed.data.capability.available ? { kind: 'ok', data: parsed.data } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export function loadMyCompletions(): Promise<MyCompletionsResult> {
  unsubscribe ??= onCompletionPublished(clearMyCompletionsCache);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cached.result);
  }
  if (!inflight) {
    const startedIn = generation;
    const request: Promise<MyCompletionsResult> = fetchMyCompletions()
      .then((result) => {
        if (result.kind === 'ok' && startedIn === generation) {
          cached = { result, fetchedAt: Date.now() };
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
  inflight = null;
}

export function __resetMyCompletionsCacheForTests(): void {
  clearMyCompletionsCache();
  unsubscribe?.();
  unsubscribe = null;
}
