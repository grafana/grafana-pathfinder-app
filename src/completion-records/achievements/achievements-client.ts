import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom, timeout, TimeoutError } from 'rxjs';

import { PLUGIN_BACKEND_URL } from '../../constants';
import { extractFetchErrorStatus } from '../../lib/fetch-error';
import {
  AchievementDefinitionsResponseWireSchema,
  AchievementEventsResponseWireSchema,
  MyAchievementsResponseWireSchema,
  type AchievementDefinitionsResponseWire,
  type AchievementEventsResponseWire,
  type MyAchievementsResponseWire,
} from '../../types/backend-api.schema';
import type { CompletionCategory } from '../types';
import { WRITE_REQUEST_TIMEOUT_MS } from '../completion-write-timing';

const ACHIEVEMENTS_URL = `${PLUGIN_BACKEND_URL}/api/v1/achievements`;
const READ_TIMEOUT_MS = 10_000;

export const ACHIEVEMENT_EVENT_SCHEMA_VERSION = 1;

export interface GuideCompletedContext {
  guideSource: string;
  guideId: string;
  guideCategory: CompletionCategory;
  pathId?: string;
}

/** RFC §6.1. Only `guides.completed` is posted, so the context is that pair's declared fields. */
export interface AchievementEventBody {
  schemaVersion: typeof ACHIEVEMENT_EVENT_SCHEMA_VERSION;
  eventId: string;
  entity: 'guides';
  action: 'completed';
  occurredAt: string;
  context: GuideCompletedContext;
}

/** `route-missing` and `forbidden` disarm the session and keep the queue (RFC §6.5). */
export type EventOutcome =
  | { kind: 'evaluated'; response: AchievementEventsResponseWire }
  | { kind: 'terminal' }
  | { kind: 'transient' }
  | { kind: 'route-missing' }
  | { kind: 'forbidden' };

export async function postAchievementEvent(body: AchievementEventBody): Promise<EventOutcome> {
  try {
    const response = await lastValueFrom(
      getBackendSrv()
        .fetch<unknown>({
          url: `${ACHIEVEMENTS_URL}/events`,
          method: 'POST',
          data: body,
          showErrorAlert: false,
          showSuccessAlert: false,
        })
        .pipe(timeout({ each: WRITE_REQUEST_TIMEOUT_MS }))
    );
    const parsed = AchievementEventsResponseWireSchema.safeParse(response.data);
    // The event was evaluated even when the body does not parse; a resend cannot do better.
    return parsed.success
      ? { kind: 'evaluated', response: parsed.data }
      : { kind: 'evaluated', response: { eventId: body.eventId, retry: false, decisions: [] } };
  } catch (err) {
    if (err instanceof TimeoutError) {
      return { kind: 'transient' };
    }
    return classifyEventError(extractFetchErrorStatus(err));
  }
}

export function classifyEventError(status: number | undefined): EventOutcome {
  if (status === 404) {
    return { kind: 'route-missing' };
  }
  if (status === 403) {
    return { kind: 'forbidden' };
  }
  if (status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
    return { kind: 'terminal' };
  }
  return { kind: 'transient' };
}

export type MyAchievementsResult = { kind: 'ok'; data: MyAchievementsResponseWire } | { kind: 'unavailable' };

export async function fetchMyAchievements(): Promise<MyAchievementsResult> {
  try {
    const response = await lastValueFrom(
      getBackendSrv()
        .fetch<unknown>({ url: `${ACHIEVEMENTS_URL}/my`, method: 'GET', showErrorAlert: false })
        .pipe(timeout(READ_TIMEOUT_MS))
    );
    const parsed = MyAchievementsResponseWireSchema.safeParse(response.data);
    return parsed.success && parsed.data.capability.available
      ? { kind: 'ok', data: parsed.data }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function fetchAchievementDefinitions(): Promise<AchievementDefinitionsResponseWire | null> {
  try {
    const response = await lastValueFrom(
      getBackendSrv()
        .fetch<unknown>({ url: `${ACHIEVEMENTS_URL}/definitions`, method: 'GET', showErrorAlert: false })
        .pipe(timeout(READ_TIMEOUT_MS))
    );
    const parsed = AchievementDefinitionsResponseWireSchema.safeParse(response.data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
