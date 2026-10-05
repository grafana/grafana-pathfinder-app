const KEY = 'pathfinder-observation-handoff';
export const OBSERVATION_HANDOFF_EVENT = 'pathfinder-observation-handoff';
export type ObservationCursors = Record<string, number>;

export function saveObservationHandoff(contentKey: string, cursors: ObservationCursors): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ contentKey, cursors, expires: Date.now() + 10_000 }));
  } catch {
    /* Handoff is best effort when browser storage is unavailable. */
  }
}

export function takeObservationHandoff(contentKey: string): ObservationCursors {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 1_048_576) {
      return {};
    }
    const value = JSON.parse(raw);
    if (value.contentKey !== contentKey || typeof value.expires !== 'number' || value.expires < Date.now()) {
      return {};
    }
    localStorage.removeItem(KEY);
    if (!value.cursors || typeof value.cursors !== 'object' || Array.isArray(value.cursors)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value.cursors).filter(
        ([id, cursor]) =>
          id.length <= 4096 &&
          typeof cursor === 'number' &&
          Number.isSafeInteger(cursor) &&
          cursor >= 0 &&
          cursor <= 256
      )
    ) as ObservationCursors;
  } catch {
    return {};
  }
}
