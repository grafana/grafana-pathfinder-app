import { config, locationService, reportExperimentView } from '@grafana/runtime';

import {
  AUTO_OPEN_GUIDE_ELIGIBLE_EVENT,
  AUTO_OPEN_GUIDE_EXPERIMENT_FLAG,
  AUTO_OPEN_GUIDE_EXPERIMENT_GROUP,
  AUTO_OPEN_GUIDE_EXPERIMENT_ID,
  ONBOARDING_EXPLORING_EXPERIMENT_ID,
  ONBOARDING_EXPLORING_EXPERIMENT_FLAG,
  ONBOARDING_EXPLORING_EXPERIMENT_GROUP,
  ONBOARDING_EXPLORING_ELIGIBLE_EVENT,
} from '../../../constants/auto-open-guide-experiment';
import {
  getOnboardingIntentContextKey,
  hasSavedExploringIntent,
  subscribeToOnboardingExploringIntent,
} from '../../../global-state/onboarding-exploring-intent';
import { startSavedIntentBridge } from './saved-intent-bridge';
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
import { hasAutoOpenGuideShown, markAutoOpenGuideShown, readConsumedVisit, writeConsumedVisit } from './markers';
import { setAutoOpenGuideEnrollment } from './state';

type EnrolledVariant = 'control' | 'treatment';

interface Offer {
  index: number;
  guide: string;
}

const isEnrolledVariant = (variant: string): variant is EnrolledVariant =>
  variant === 'control' || variant === 'treatment';

// A plain evaluation: the flag has no trackingKey, so only activate() counts as an exposure.
function readTargeting(
  flag: typeof AUTO_OPEN_GUIDE_EXPERIMENT_FLAG | typeof ONBOARDING_EXPLORING_EXPERIMENT_FLAG
): AutoOpenGuideConfig | null {
  try {
    const value = getFeatureFlagClient().getObjectValue(flag, { variant: 'excluded' });
    if (!isAutoOpenGuideConfig(value)) {
      warnExperimentRejection('remote', flag, value);
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

function findOffer(
  targeting: AutoOpenGuideConfig,
  alreadyShown: (guide: string) => boolean,
  path: string
): Offer | null {
  const index = targeting.experiences.findIndex(
    (experience) => matchesExperience(experience, path) && !alreadyShown(experience.guide)
  );
  return index === -1 ? null : { index, guide: targeting.experiences[index]!.guide };
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
  const exploringTargeting = readTargeting(ONBOARDING_EXPLORING_EXPERIMENT_FLAG);
  const legacyTargeting = readTargeting(AUTO_OPEN_GUIDE_EXPERIMENT_FLAG);
  if (exploringTargeting && legacyTargeting) {
    logger.warn('[Pathfinder] Auto-open experiments overlap; neither will enroll');
    return () => {};
  }
  const requiresExploring = exploringTargeting !== null;
  const pageTargeting = exploringTargeting ?? legacyTargeting;
  const experimentId = requiresExploring ? ONBOARDING_EXPLORING_EXPERIMENT_ID : AUTO_OPEN_GUIDE_EXPERIMENT_ID;
  const experimentFlag = requiresExploring ? ONBOARDING_EXPLORING_EXPERIMENT_FLAG : AUTO_OPEN_GUIDE_EXPERIMENT_FLAG;
  const experimentGroup = requiresExploring ? ONBOARDING_EXPLORING_EXPERIMENT_GROUP : AUTO_OPEN_GUIDE_EXPERIMENT_GROUP;
  const eligibleEvent = requiresExploring ? ONBOARDING_EXPLORING_ELIGIBLE_EVENT : AUTO_OPEN_GUIDE_ELIGIBLE_EVENT;
  const contextKey = getOnboardingIntentContextKey();
  const hostname = window.location.hostname;
  const exploringScope = `${hostname}:${ONBOARDING_EXPLORING_EXPERIMENT_ID}:${contextKey}`;
  const previousContextKey = JSON.stringify([
    config.namespace ?? '',
    config.bootData.user.id,
    config.bootData.user.orgId,
  ]);
  const previousExploringScope = `${hostname}:${ONBOARDING_EXPLORING_EXPERIMENT_ID}:${previousContextKey}`;
  const markerScope = requiresExploring ? exploringScope : hostname;
  const alreadyShown = (guide: string) =>
    hasAutoOpenGuideShown(hostname, guide) ||
    hasAutoOpenGuideShown(exploringScope, guide) ||
    hasAutoOpenGuideShown(previousExploringScope, guide);
  const intentEligible = () => !requiresExploring || hasSavedExploringIntent();
  let pendingOffer: { offer: Offer; targeting: AutoOpenGuideConfig } | undefined;
  const currentOfferEligible = () =>
    !pendingOffer ||
    (matchesExperience(pendingOffer.targeting.experiences[pendingOffer.offer.index]!, getCurrentPath()) && canPopOut());
  const sdk = createPathfinderExperiments({
    scope: 'grafana-pathfinder-app',
    client: getFeatureFlagClient(),
    recordFlagValue: false,
    contextKey,
    isEnabled: () =>
      document.visibilityState === 'visible' &&
      config.analytics?.enabled !== false &&
      config.bootData.user.isSignedIn &&
      contextKey === getOnboardingIntentContextKey() &&
      intentEligible() &&
      (!requiresExploring || currentOfferEligible()),
    reportExposure: ({ experiment_id, experiment_group, variant }) =>
      reportExperimentView(experiment_id, experiment_group, variant),
    reportAnalytics: (name, properties) => {
      const assignment = sdk?.getActiveAssignments().find((entry) => entry.experiment_id === experimentId);
      if (name !== eligibleEvent || !assignment) {
        return;
      }
      reportAppInteraction(
        requiresExploring ? UserInteraction.OnboardingExploringEligible : UserInteraction.AutoOpenGuideEligible,
        {
          [requiresExploring ? 'experiment_onboarding_exploring_auto_open' : 'experiment_auto_open_guide']:
            assignment.variant,
          exposure_id: assignment.exposure_id,
          event_id: String(properties.event_id),
          experience_index: Number(properties.experience_index),
          opened: properties.opened === true,
        },
        { mirrorToFaro: false }
      );
    },
    eventDefinitions: {
      [eligibleEvent]: {
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
    id: experimentId,
    flagKey: experimentFlag,
    group: experimentGroup,
    flag: { type: 'object', validate: isAutoOpenGuideConfig },
  });
  await sdk.ready;

  let stopped = false;
  let pending: AbortController | undefined;
  let activationTimer: ReturnType<typeof setTimeout> | undefined;
  let recheck = false;
  let consumedVisit = readConsumedVisit(markerScope);
  if (requiresExploring) {
    const previousVisit = readConsumedVisit(previousExploringScope);
    if (consumedVisit === undefined && previousVisit !== undefined) {
      consumedVisit = previousVisit;
      writeConsumedVisit(markerScope, previousVisit);
    }
    writeConsumedVisit(previousExploringScope, undefined);
  }
  // Held in memory from activation start; persisted only once an offer applies, so a reload
  // mid-activation or after a failed one gets its own attempt.
  const consumeVisit = (visit: string | undefined) => {
    consumedVisit = visit;
    if (visit === undefined) {
      writeConsumedVisit(markerScope, undefined);
    }
  };
  const warnedUnavailable = new Set<string>();
  let cancelAutoLaunch = () => {};
  let cancelAutoOpen = () => {};

  const apply = (offer: Offer, variant: EnrolledVariant, targeting: AutoOpenGuideConfig) => {
    if (
      requiresExploring &&
      (!intentEligible() || !currentOfferEligible() || contextKey !== getOnboardingIntentContextKey())
    ) {
      consumeVisit(undefined);
      return;
    }
    pendingOffer = undefined;
    restored = true;
    setAutoOpenGuideEnrollment({
      variant,
      experiences: targeting.experiences,
      offeredGuide: offer.guide,
      flag: experimentFlag,
    });
    notifyEnrollment();
    markAutoOpenGuideShown(markerScope, offer.guide);
    writeConsumedVisit(markerScope, consumedVisit);
    const docPage = findDocPage(offer.guide);
    const stillOnOffer = matchesExperience(targeting.experiences[offer.index]!, getCurrentPath());
    const opened = variant === 'treatment' && docPage !== null && stillOnOffer && canPopOut();
    if (opened) {
      cancelAutoOpen();
      cancelAutoLaunch();
      let openRequested = false;
      const cancelLaunch = installAutoLaunchOnMount(
        docPage,
        () =>
          openRequested &&
          !stopped &&
          contextKey === getOnboardingIntentContextKey() &&
          intentEligible() &&
          matchesExperience(targeting.experiences[offer.index]!, getCurrentPath())
      );
      cancelAutoLaunch = cancelLaunch;
      cancelAutoOpen = attemptAutoOpen(requiresExploring ? 0 : 200, () => {
        openRequested =
          !stopped &&
          contextKey === getOnboardingIntentContextKey() &&
          intentEligible() &&
          matchesExperience(targeting.experiences[offer.index]!, getCurrentPath()) &&
          canPopOut();
        if (openRequested) {
          sidebarState.setPendingOpenSource('auto_open_guide_experiment', 'auto_open');
        } else {
          cancelLaunch();
        }
        return openRequested;
      });
    }
    sdk.reportAnalytics(eligibleEvent, { experience_index: offer.index, opened });
  };

  const activate = (offer: Offer, targeting: AutoOpenGuideConfig) => {
    const activation = new AbortController();
    pending = activation;
    pendingOffer = { offer, targeting };
    recheck = false;
    const run = () => {
      activationTimer = undefined;
      if (stopped || pending !== activation || activation.signal.aborted) {
        return;
      }
      if (requiresExploring) {
        sdk.refreshSession();
      }
      void experiment
        .activate({ signal: activation.signal })
        .then((state) => {
          if (stopped || pending !== activation) {
            return;
          }
          pending = undefined;
          if (state.status === 'active' && isEnrolledVariant(state.variant)) {
            apply(offer, state.variant, targeting);
          } else if (state.status === 'inactive' || (state.status === 'unavailable' && state.reason === 'disabled')) {
            // A tab hidden mid-activation must not use up the visit; the next visibilitychange retries.
            consumeVisit(undefined);
          } else if (state.status === 'unavailable') {
            if (!warnedUnavailable.has(state.reason)) {
              warnedUnavailable.add(state.reason);
              logger.warn('[Pathfinder] Auto-open guide experiment unavailable', { reason: state.reason });
            }
          }
          pendingOffer = undefined;
          if (recheck) {
            recheck = false;
            check();
          }
        })
        .catch(() => {
          if (pending === activation) {
            pending = undefined;
            pendingOffer = undefined;
          }
        });
    };
    if (requiresExploring) {
      activationTimer = setTimeout(run, 200);
    } else {
      run();
    }
  };

  // Each visit gets at most one activation, whatever it resolves to, so a result that
  // offers nothing can never re-trigger itself.
  const check = () => {
    if (stopped) {
      return;
    }
    if (
      requiresExploring &&
      (!intentEligible() || contextKey !== getOnboardingIntentContextKey() || !currentOfferEligible())
    ) {
      if (pending) {
        pending.abort();
        clearTimeout(activationTimer);
        consumeVisit(undefined);
      }
      pending = undefined;
      pendingOffer = undefined;
      cancelAutoLaunch();
      cancelAutoOpen();
      if (!intentEligible()) {
        restored = false;
        setAutoOpenGuideEnrollment(null);
        notifyEnrollment();
      }
      if (!intentEligible() || contextKey !== getOnboardingIntentContextKey()) {
        return;
      }
    }
    restoreEnrollment();
    if (pending) {
      recheck = true;
      return;
    }
    const targeting = pageTargeting;
    if (!targeting) {
      return;
    }
    const path = getCurrentPath();
    const visit = visitKey(targeting, path);
    if (consumedVisit !== undefined && visit !== consumedVisit) {
      consumeVisit(undefined);
    }
    if (!visit || consumedVisit !== undefined || !canPopOut()) {
      return;
    }
    const offer = findOffer(targeting, alreadyShown, path);
    if (offer) {
      consumeVisit(visit);
      activate(offer, targeting);
    }
  };

  let restored = false;
  const restoreEnrollment = () => {
    if (restored) {
      return;
    }
    if (!intentEligible() || contextKey !== getOnboardingIntentContextKey()) {
      return;
    }
    const bootTargeting = pageTargeting;
    if (
      bootTargeting &&
      isEnrolledVariant(bootTargeting.variant) &&
      bootTargeting.experiences.some((experience) => hasAutoOpenGuideShown(markerScope, experience.guide))
    ) {
      restored = true;
      setAutoOpenGuideEnrollment({
        variant: bootTargeting.variant,
        experiences: bootTargeting.experiences,
        flag: experimentFlag,
      });
      notifyEnrollment();
    }
  };
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
  const unsubscribeIntent = requiresExploring
    ? subscribeToOnboardingExploringIntent(() => {
        check();
        sdk.refreshSession();
        check();
      })
    : () => {};
  const stopIntentBridge = exploringTargeting
    ? startSavedIntentBridge((path) =>
        exploringTargeting.experiences.some((experience) => matchesExperience(experience, path))
      )
    : () => {};

  return () => {
    stopped = true;
    pending?.abort();
    clearTimeout(activationTimer);
    cancelAutoLaunch();
    cancelAutoOpen();
    stopIntentBridge();
    unsubscribeIntent();
    unlisten();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    sdk.dispose();
  };
}
