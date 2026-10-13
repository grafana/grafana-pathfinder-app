import { config, locationService, reportExperimentView } from '@grafana/runtime';

import {
  AUTO_OPEN_GUIDE_ELIGIBLE_EVENT,
  AUTO_OPEN_GUIDE_EXPERIMENT_FLAG,
  AUTO_OPEN_GUIDE_EXPERIMENT_GROUP,
  AUTO_OPEN_GUIDE_EXPERIMENT_ID,
} from '../../../constants/auto-open-guide-experiment';
import { kioskState } from '../../../global-state/kiosk';
import { sidebarState } from '../../../global-state/sidebar';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { isExtensionSidebarInUse } from '../../../lib/storage/extension-sidebar';
import { createPathfinderExperiments } from '../../../lib/telemetry/experiments';
import { isPathfinderOpen } from '../../../lib/telemetry/surface';
import { findDocPage } from '../../find-doc-page';
import { getFeatureFlagClient } from '../../openfeature';
import { parsePathfinderDeepLink } from '../../pathfinder-search-params';
import { attemptAutoOpen, getCurrentPath } from '../../sidebar-auto-open';
import { notifyEnrollment } from '../enrollment-notifier';
import { installAutoLaunchOnMount } from './auto-launch';
import { isAutoOpenGuideConfig, matchesExperience, type AutoOpenGuideConfig } from './config';
import { hasAutoOpenGuideShown, markAutoOpenGuideShown } from './markers';
import { setAutoOpenGuideEnrollment } from './state';

interface Offer {
  index: number;
  guide: string;
  path: string;
}

// A plain evaluation: the flag has no trackingKey, so only activate() counts as an exposure.
function readTargeting(): AutoOpenGuideConfig | null {
  try {
    const value = getFeatureFlagClient().getObjectValue(AUTO_OPEN_GUIDE_EXPERIMENT_FLAG, { variant: 'excluded' });
    return isAutoOpenGuideConfig(value) && value.variant !== 'excluded' ? value : null;
  } catch {
    return null;
  }
}

function findOffer(targeting: AutoOpenGuideConfig, hostname: string, path: string): Offer | null {
  const index = targeting.experiences.findIndex(
    (experience) => matchesExperience(experience, path) && !hasAutoOpenGuideShown(hostname, experience.guide)
  );
  return index === -1 ? null : { index, guide: targeting.experiences[index]!.guide, path };
}

function canPopOut(): boolean {
  const params = parsePathfinderDeepLink(window.location.search);
  return (
    document.visibilityState === 'visible' &&
    !isPathfinderOpen() &&
    !isExtensionSidebarInUse() &&
    !kioskState.getSnapshot() &&
    !params.doc &&
    !params.controller &&
    !params.pathfinderKiosk
  );
}

export async function startAutoOpenGuideExperiment(): Promise<() => void> {
  if (!config.namespace || !config.bootData.user.isSignedIn || config.analytics?.enabled === false) {
    return () => {};
  }
  const contextKey = `${config.namespace}:${config.bootData.user.id}`;
  const hostname = window.location.hostname;
  const sdk = createPathfinderExperiments({
    scope: 'grafana-pathfinder-app',
    client: getFeatureFlagClient(),
    recordFlagValue: false,
    contextKey,
    isEnabled: () =>
      config.analytics?.enabled !== false &&
      config.bootData.user.isSignedIn &&
      contextKey === `${config.namespace}:${config.bootData.user.id}`,
    reportExposure: ({ experiment_id, experiment_group, variant }) =>
      reportExperimentView(experiment_id, experiment_group, variant),
    reportAnalytics: (name, properties) => {
      const assignment = sdk
        ?.getActiveAssignments()
        .find((entry) => entry.experiment_id === AUTO_OPEN_GUIDE_EXPERIMENT_ID);
      if (name !== AUTO_OPEN_GUIDE_ELIGIBLE_EVENT || !assignment) {
        return;
      }
      reportAppInteraction(
        UserInteraction.AutoOpenGuideEligible,
        {
          experiment_auto_open_guide: assignment.variant,
          exposure_id: assignment.exposure_id,
          event_id: String(properties.event_id),
          experience_index: Number(properties.experience_index),
          opened: properties.opened === true,
        },
        { mirrorToFaro: false }
      );
    },
    eventDefinitions: {
      [AUTO_OPEN_GUIDE_ELIGIBLE_EVENT]: {
        version: 1,
        properties: {
          experience_index: { type: 'number', required: true },
          opened: { type: 'boolean', required: true },
        },
      },
    },
  });
  if (!sdk) {
    return () => {};
  }
  const experiment = sdk.defineExperiment<AutoOpenGuideConfig>({
    id: AUTO_OPEN_GUIDE_EXPERIMENT_ID,
    flagKey: AUTO_OPEN_GUIDE_EXPERIMENT_FLAG,
    group: AUTO_OPEN_GUIDE_EXPERIMENT_GROUP,
    flag: { type: 'object', validate: isAutoOpenGuideConfig },
  });
  await sdk.ready;

  let stopped = false;
  let pending: AbortController | undefined;

  const apply = (offer: Offer | null, enrolled: AutoOpenGuideConfig) => {
    const { variant } = enrolled;
    if (variant !== 'control' && variant !== 'treatment') {
      return;
    }
    setAutoOpenGuideEnrollment({ variant, experiences: enrolled.experiences });
    notifyEnrollment();
    if (!offer || enrolled.experiences[offer.index]?.guide !== offer.guide) {
      return;
    }
    markAutoOpenGuideShown(hostname, offer.guide);
    const docPage = findDocPage(offer.guide);
    const opened = variant === 'treatment' && docPage !== null && getCurrentPath() === offer.path && canPopOut();
    if (opened) {
      sidebarState.setPendingOpenSource('auto_open_guide_experiment', 'auto-open');
      installAutoLaunchOnMount(docPage);
      attemptAutoOpen();
    }
    sdk.reportAnalytics(AUTO_OPEN_GUIDE_ELIGIBLE_EVENT, { experience_index: offer.index, opened });
  };

  const activate = (offer: Offer | null) => {
    const activation = new AbortController();
    pending = activation;
    void experiment
      .activate({ signal: activation.signal })
      .then((state) => {
        if (stopped || pending !== activation) {
          return;
        }
        pending = undefined;
        if (state.status === 'active' && state.config) {
          apply(offer, state.config);
        }
        check();
      })
      .catch(() => {
        if (pending === activation) {
          pending = undefined;
        }
      });
  };

  const check = () => {
    if (stopped || pending || !canPopOut()) {
      return;
    }
    const targeting = readTargeting();
    const offer = targeting ? findOffer(targeting, hostname, getCurrentPath()) : null;
    if (offer) {
      activate(offer);
    }
  };

  // A browser already offered a guide re-activates at boot, so its guide events keep the arm after a reload.
  const targeting = readTargeting();
  const bootOffer = targeting ? findOffer(targeting, hostname, getCurrentPath()) : null;
  if (bootOffer && canPopOut()) {
    activate(bootOffer);
  } else if (targeting?.experiences.some((experience) => hasAutoOpenGuideShown(hostname, experience.guide))) {
    activate(null);
  }

  let unlisten = () => {};
  try {
    unlisten = locationService.getHistory().listen(check);
  } catch {
    window.addEventListener('popstate', check);
    unlisten = () => window.removeEventListener('popstate', check);
  }
  document.addEventListener('visibilitychange', check);

  return () => {
    stopped = true;
    pending?.abort();
    unlisten();
    document.removeEventListener('visibilitychange', check);
    sdk.dispose();
  };
}
