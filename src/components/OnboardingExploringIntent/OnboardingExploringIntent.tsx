import React, { useEffect, useMemo } from 'react';
import { usePluginComponent } from '@grafana/runtime';

import {
  ONBOARDING_EXPLORING_COMPONENT_ID,
  ONBOARDING_EXPLORING_EXPERIMENT_FLAG,
} from '../../constants/auto-open-guide-experiment';
import {
  setOnboardingExploringIntent,
  type OnboardingExploringIntentSnapshot,
} from '../../global-state/onboarding-exploring-intent';
import { getFeatureFlagClient } from '../../utils/openfeature';
import { isAutoOpenGuideConfig } from '../../utils/experiments/auto-open-guide/config';

interface IntentProps {
  onChange: (snapshot: OnboardingExploringIntentSnapshot) => void;
}

function SavedIntentBridge() {
  const { component: Intent } = usePluginComponent<IntentProps>(ONBOARDING_EXPLORING_COMPONENT_ID);
  useEffect(() => {
    if (!Intent) {
      setOnboardingExploringIntent(null);
    }
    return () => setOnboardingExploringIntent(null);
  }, [Intent]);
  return Intent ? <Intent onChange={setOnboardingExploringIntent} /> : null;
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
