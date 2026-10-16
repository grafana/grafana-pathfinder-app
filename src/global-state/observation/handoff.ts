import type { StartedStep } from './coordinator';

const KEY = 'pathfinder-observation-handoff';
export const OBSERVATION_HANDOFF_EVENT = 'pathfinder-observation-handoff';
export type ObservationCursors = Record<string, number>;
export interface ObservationHandoff {
  cursors: ObservationCursors;
  started: StartedStep[];
}
const isBounded = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096;
const isStartedStep = (value: unknown): value is StartedStep => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const { id, stepId, guideKey, sectionId } = value as Record<string, unknown>;
  return (
    isBounded(id) &&
    isBounded(stepId) &&
    (guideKey === undefined || isBounded(guideKey)) &&
    (sectionId === undefined || isBounded(sectionId))
  );
};
const EMPTY: ObservationHandoff = { cursors: {}, started: [] };

export function saveObservationHandoff(contentKey: string, { cursors, started }: ObservationHandoff): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ contentKey, cursors, started, expires: Date.now() + 10_000 }));
  } catch {
    /* Handoff is best effort when browser storage is unavailable. */
  }
}

export function takeObservationHandoff(contentKey: string): ObservationHandoff {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 1_048_576) {
      return EMPTY;
    }
    const value = JSON.parse(raw);
    if (value.contentKey !== contentKey || typeof value.expires !== 'number' || value.expires < Date.now()) {
      return EMPTY;
    }
    localStorage.removeItem(KEY);
    if (!value.cursors || typeof value.cursors !== 'object' || Array.isArray(value.cursors)) {
      return EMPTY;
    }
    const cursors = Object.fromEntries(
      Object.entries(value.cursors).filter(
        ([id, cursor]) =>
          id.length <= 4096 &&
          typeof cursor === 'number' &&
          Number.isSafeInteger(cursor) &&
          cursor >= 0 &&
          cursor <= 256
      )
    ) as ObservationCursors;
    const started: StartedStep[] = Array.isArray(value.started)
      ? value.started
          .filter(isStartedStep)
          .slice(0, 256)
          .map(({ id, stepId, guideKey, sectionId }: StartedStep) => ({ id, stepId, guideKey, sectionId }))
      : [];
    return { cursors, started };
  } catch {
    return EMPTY;
  }
}
