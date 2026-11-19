import { FOLLOW_GRAFANA, type GuideLanguagePreference } from '../lib/guide-language';

interface OneShotOverride {
  language: string;
  guideKey: string | null;
}

export interface GuideLanguageState {
  preferred: GuideLanguagePreference;
  preferredLoaded: boolean;
  override: OneShotOverride | null;
  openGuideKey: string | null;
}

const INITIAL_STATE: GuideLanguageState = {
  preferred: FOLLOW_GRAFANA,
  preferredLoaded: false,
  override: null,
  openGuideKey: null,
};

let state: GuideLanguageState = INITIAL_STATE;
const listeners = new Set<() => void>();
const openCounts = new Map<string, number>();

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

export function setGuideLanguageOverride(language: string, guideKey?: string): void {
  update({ ...state, override: { language, guideKey: guideKey ?? state.openGuideKey } });
}

export function clearGuideLanguageOverride(): void {
  if (state.override !== null) {
    update({ ...state, override: null });
  }
}

/**
 * An override binds to the guide open when it is applied, or else to the next guide opened.
 * Opening any other guide or closing the bound one drops it, so it covers exactly one guide open.
 */
export function observeGuideOpen(guideKey: string): void {
  openCounts.set(guideKey, (openCounts.get(guideKey) ?? 0) + 1);
  const { override } = state;
  const nextOverride =
    override === null || override.guideKey === guideKey
      ? override
      : override.guideKey === null
        ? { ...override, guideKey }
        : null;
  update({ ...state, openGuideKey: guideKey, override: nextOverride });
}

/**
 * A guide counts as closed only once no instance shows it after the current commit settles, so a
 * remount of the same guide (panel-mode switch, StrictMode effect replay) keeps its override.
 */
export function observeGuideClose(guideKey: string): void {
  const remaining = (openCounts.get(guideKey) ?? 1) - 1;
  if (remaining > 0) {
    openCounts.set(guideKey, remaining);
    return;
  }
  openCounts.delete(guideKey);
  queueMicrotask(() => {
    if (openCounts.has(guideKey)) {
      return;
    }
    update({
      ...state,
      openGuideKey: state.openGuideKey === guideKey ? null : state.openGuideKey,
      override: state.override?.guideKey === guideKey ? null : state.override,
    });
  });
}

export function resetGuideLanguageStateForTests(): void {
  openCounts.clear();
  state = INITIAL_STATE;
  listeners.clear();
}
