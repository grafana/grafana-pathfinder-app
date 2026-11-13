import { config, getBackendSrv } from '@grafana/runtime';
import { firstValueFrom, fromEvent, takeUntil, timeout } from 'rxjs';

export interface SavedSurveyResult {
  status: 'ready' | 'unavailable';
  exploring: boolean;
}

export function getSurveyUserUid(): string | null {
  const user = config.bootData.user;
  if (!user.isSignedIn) {
    return null;
  }
  return typeof user.uid === 'string' && user.uid.length > 0
    ? user.uid
    : Number.isSafeInteger(user.id) && user.id > 0
      ? String(user.id)
      : null;
}

function parseSurveyResponse(value: unknown): SavedSurveyResult {
  const unavailable: SavedSurveyResult = { status: 'unavailable', exploring: false };
  if (!value || typeof value !== 'object' || !('spec' in value)) {
    return unavailable;
  }
  const spec = value.spec;
  if (!spec || typeof spec !== 'object' || !('data' in spec)) {
    return unavailable;
  }
  const data = spec.data;
  if (!data || typeof data !== 'object') {
    return unavailable;
  }
  const raw = (data as Record<string, unknown>)['onboarding-flow.survey-intent'];
  if (raw === undefined) {
    return { status: 'ready', exploring: false };
  }
  if (typeof raw !== 'string' || raw.length > 4096) {
    return unavailable;
  }
  try {
    const survey: unknown = JSON.parse(raw);
    if (!survey || typeof survey !== 'object' || !('targetSystem' in survey)) {
      return unavailable;
    }
    const target = survey.targetSystem;
    if (
      typeof target !== 'string' ||
      !['exploring', 'kubernetes', 'website-api', 'servers-vms', 'app'].includes(target)
    ) {
      return unavailable;
    }
    return { status: 'ready', exploring: target === 'exploring' };
  } catch {
    return unavailable;
  }
}

function onboardingSurveyIntentUrl(namespace: string, uid: string): string {
  return `/apis/userstorage.grafana.app/v0alpha1/namespaces/${encodeURIComponent(namespace)}/user-storage/${encodeURIComponent(`grafana-setupguide-app:${uid}`)}`;
}

export async function readSavedSurveyIntent(signal: AbortSignal): Promise<SavedSurveyResult> {
  const unavailable: SavedSurveyResult = { status: 'unavailable', exploring: false };
  const uid = getSurveyUserUid();
  const namespace = config.namespace;
  if (!uid || !namespace || signal.aborted) {
    return unavailable;
  }
  try {
    const response = await firstValueFrom(
      getBackendSrv()
        .fetch<unknown>({ method: 'GET', url: onboardingSurveyIntentUrl(namespace, uid), showErrorAlert: false })
        .pipe(timeout(5000), takeUntil(fromEvent(signal, 'abort')))
    );
    return parseSurveyResponse(response.data);
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
      return { status: 'ready', exploring: false };
    }
    return unavailable;
  }
}
