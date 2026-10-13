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
import { logger } from '../../../lib/logging';
import { isExtensionSidebarInUse } from '../../../lib/storage/extension-sidebar';
import { createPathfinderExperiments } from '../../../lib/telemetry/experiments';
import { isPathfinderOpen } from '../../../lib/telemetry/surface';
import { findDocPage } from '../../find-doc-page';
import { getFeatureFlagClient, warnExperimentRejection } from '../../openfeature';
import { parsePathfinderDeepLink } from '../../pathfinder-search-params';
import { attemptAutoOpen, getCurrentPath } from '../../sidebar-auto-open';
import { notifyEnrollment } from '../enrollment-notifier';
import { installAutoLaunchOnMount } from './auto-launch';
import { isAutoOpenGuideConfig, matchesExperience, type AutoOpenGuideConfig } from './config';
import { hasAutoOpenGuideShown, markAutoOpenGuideShown } from './markers';
import { setAutoOpenGuideEnrollment } from './state';

type EnrolledVariant = 'control' | 'treatment';

interface Offer {
  index: number;
  guide: string;
  path: string;
}

const isEnrolledVariant = (variant: string): variant is EnrolledVariant =>
  variant === 'control' || variant === 'treatment';

// A plain evaluation: the flag has no trackingKey, so only activate() counts as an exposure.
function readTargeting(): AutoOpenGuideConfig | null {
  try {
    const value = getFeatureFlagClient().getObjectValue(AUTO_OPEN_GUIDE_EXPERIMENT_FLAG, { variant: 'excluded' });
    if (!isAutoOpenGuideConfig(value)) {
      warnExperimentRejection('remote', AUTO_OPEN_GUIDE_EXPERIMENT_FLAG, value);
      return null;
    }
    return value.variant === 'excluded' ? null : value;
  } catch {
    return null;
  }
}

// The guides matching a path: one visit lasts while this stays the same, so sub-paths
// of one pattern never re-offer an overlapping experience.
function visitKey(targeting: AutoOpenGuideConfig, path: string): string {
  return targeting.experiences
    .filter((experience) => matchesExperience(experience, path))
    .map((experience) => experience.guide)
    .join('\n');
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
      document.visibilityState === 'visible' &&
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
  let recheck = false;
  let consumedVisit: string | undefined;
  const warnedUnavailable = new Set<string>();

  const apply = (offer: Offer, variant: EnrolledVariant, targeting: AutoOpenGuideConfig) => {
    setAutoOpenGuideEnrollment({ variant, experiences: targeting.experiences, offeredGuide: offer.guide });
    notifyEnrollment();
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

  const activate = (offer: Offer, targeting: AutoOpenGuideConfig) => {
    const activation = new AbortController();
    pending = activation;
    recheck = false;
    void experiment
      .activate({ signal: activation.signal })
      .then((state) => {
        if (stopped || pending !== activation) {
          return;
        }
        pending = undefined;
        if (state.status === 'active' && isEnrolledVariant(state.variant)) {
          apply(offer, state.variant, targeting);
        } else if (state.status === 'unavailable' && !warnedUnavailable.has(state.reason)) {
          warnedUnavailable.add(state.reason);
          logger.warn('[Pathfinder] Auto-open guide experiment unavailable', { reason: state.reason });
        }
        if (recheck) {
          recheck = false;
          check();
        }
      })
      .catch(() => {
        if (pending === activation) {
          pending = undefined;
        }
      });
  };

  // Each visit gets at most one activation, whatever it resolves to, so a result that
  // offers nothing can never re-trigger itself.
  const check = () => {
    if (stopped) {
      return;
    }
    if (pending) {
      recheck = true;
      return;
    }
    const targeting = readTargeting();
    if (!targeting) {
      return;
    }
    const path = getCurrentPath();
    const visit = visitKey(targeting, path);
    if (visit !== consumedVisit) {
      consumedVisit = undefined;
    }
    if (!visit || consumedVisit !== undefined || !canPopOut()) {
      return;
    }
    const offer = findOffer(targeting, hostname, path);
    if (offer) {
      consumedVisit = visit;
      activate(offer, targeting);
    }
  };

  // Restores the arm for guide-event attribution after a reload without a new exposure.
  const bootTargeting = readTargeting();
  if (
    bootTargeting &&
    isEnrolledVariant(bootTargeting.variant) &&
    bootTargeting.experiences.some((experience) => hasAutoOpenGuideShown(hostname, experience.guide))
  ) {
    setAutoOpenGuideEnrollment({ variant: bootTargeting.variant, experiences: bootTargeting.experiences });
    notifyEnrollment();
  }
  check();

  let unlisten = () => {};
  try {
    unlisten = locationService.getHistory().listen(check);
  } catch {
    window.addEventListener('popstate', check);
    unlisten = () => window.removeEventListener('popstate', check);
  }
  // isEnabled reads visibility, and the SDK only re-reads it on refreshSession().
  const onVisibilityChange = () => {
    sdk.refreshSession();
    check();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    stopped = true;
    pending?.abort();
    unlisten();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    sdk.dispose();
  };
}
