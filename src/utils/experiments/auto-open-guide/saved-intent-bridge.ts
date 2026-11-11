import { locationService } from '@grafana/runtime';

import {
  getOnboardingIntentContextKey,
  setOnboardingExploringIntent,
} from '../../../global-state/onboarding-exploring-intent';
import { getSurveyUserUid, readSavedSurveyIntent } from '../../../lib/onboarding-survey-intent';

// Grafana renders grafana/app/chrome/v1 only for grafana-setupguide-app, so this runs from the experiment instead.
export function startSavedIntentBridge(): () => void {
  const contextKey = getOnboardingIntentContextKey();
  let disposed = false;
  let generation = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const uid = getSurveyUserUid();
  const current = () => !disposed && contextKey === getOnboardingIntentContextKey() && uid === getSurveyUserUid();
  const cancel = () => {
    generation++;
    controller?.abort();
    clearTimeout(timer);
  };
  const refresh = (delay = 500) => {
    cancel();
    if (!current() || !uid) {
      setOnboardingExploringIntent(null);
      return;
    }
    // Keep the last answer while revalidating: clearing it cancels a launch already in flight.
    if (document.visibilityState === 'hidden') {
      return;
    }
    const cycle = generation;
    let attempt = 0;
    const read = async () => {
      if (!current() || cycle !== generation) {
        return;
      }
      attempt++;
      controller = new AbortController();
      const result = await readSavedSurveyIntent(controller.signal);
      if (!current() || cycle !== generation) {
        return;
      }
      setOnboardingExploringIntent({ ...result, contextKey });
      if (result.status === 'ready' && !result.exploring && attempt < 4) {
        timer = setTimeout(() => void read(), [500, 1500, 3000][attempt - 1]);
      }
    };
    if (delay === 0) {
      void read();
    } else {
      timer = setTimeout(() => void read(), delay);
    }
  };
  let previousPath = window.location.pathname;
  const onLocation = (pathname: string) => {
    const changed = previousPath !== pathname;
    previousPath = pathname;
    if (changed || !current()) {
      refresh();
    }
  };
  let unlisten: () => void;
  try {
    const history = locationService.getHistory();
    previousPath = history.location.pathname;
    unlisten = history.listen((location: { pathname: string }) => onLocation(location.pathname));
  } catch {
    const onPopState = () => onLocation(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    unlisten = () => window.removeEventListener('popstate', onPopState);
  }
  const onVisibility = () => refresh();
  document.addEventListener('visibilitychange', onVisibility);
  refresh(0);
  return () => {
    disposed = true;
    cancel();
    unlisten();
    document.removeEventListener('visibilitychange', onVisibility);
    setOnboardingExploringIntent(null);
  };
}
