import { FOLLOW_GRAFANA, type GuideLanguagePreference } from '../lib/guide-language';

interface OneShotOverride {
  language: string;
  guideKey: string | null;
}

export interface GuideLanguageState {
  preferred: GuideLanguagePreference;
  preferredLoaded: boolean;
  override: OneShotOverride | null;
}

const INITIAL_STATE: GuideLanguageState = { preferred: FOLLOW_GRAFANA, preferredLoaded: false, override: null };

let state: GuideLanguageState = INITIAL_STATE;
const listeners = new Set<() => void>();

function update(next: GuideLanguageState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribeGuideLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGuideLanguageState(): GuideLanguageState {
  return state;
}

export function setGuideLanguagePreferred(preferred: GuideLanguagePreference): void {
  update({ ...state, preferred, preferredLoaded: true });
}

export function setGuideLanguageOverride(language: string, guideKey: string | null = null): void {
  update({ ...state, override: { language, guideKey } });
}

export function clearGuideLanguageOverride(): void {
  if (state.override !== null) {
    update({ ...state, override: null });
  }
}

/**
 * The first guide opened after an override binds it; any other guide opened afterwards drops it,
 * so a one-open hint never carries over to the next guide.
 */
export function observeGuideOpen(guideKey: string): void {
  const { override } = state;
  if (override === null || override.guideKey === guideKey) {
    return;
  }
  update({ ...state, override: override.guideKey === null ? { ...override, guideKey } : null });
}

export function resetGuideLanguageStateForTests(): void {
  state = INITIAL_STATE;
  listeners.clear();
}
