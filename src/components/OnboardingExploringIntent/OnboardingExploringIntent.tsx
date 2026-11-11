import React, { useEffect, useMemo } from 'react';
import { locationService } from '@grafana/runtime';

import { ONBOARDING_EXPLORING_EXPERIMENT_FLAG } from '../../constants/auto-open-guide-experiment';
import {
  setOnboardingExploringIntent,
  getOnboardingIntentContextKey,
} from '../../global-state/onboarding-exploring-intent';
import { getSurveyUserUid, readSavedSurveyIntent } from '../../lib/onboarding-survey-intent';
import { getFeatureFlagClient } from '../../utils/openfeature';
import { isAutoOpenGuideConfig } from '../../utils/experiments/auto-open-guide/config';

function SavedIntentBridge() {
  const contextKey = getOnboardingIntentContextKey();
  useEffect(() => {
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
    const history = locationService.getHistory();
    let previousPath = history.location.pathname;
    const unlisten = history.listen((location: { pathname: string }) => {
      const changed = previousPath !== location.pathname;
      previousPath = location.pathname;
      if (changed || !current()) {
        refresh();
      }
    });
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
  }, [contextKey]);
  return null;
}

export default function OnboardingExploringIntent() {
  const enabled = useMemo(() => {
    try {
      const value = getFeatureFlagClient().getObjectValue(ONBOARDING_EXPLORING_EXPERIMENT_FLAG, {
        variant: 'excluded',
      });
      return isAutoOpenGuideConfig(value) && value.variant !== 'excluded';
    } catch {
      return false;
    }
  }, []);
  return enabled ? <SavedIntentBridge /> : null;
}
