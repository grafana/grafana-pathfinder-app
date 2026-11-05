import { autoLaunchChannel } from '../../global-state/auto-launch';
import { onPathfinderSurfaceChange } from '../../lib/telemetry/surface';
import { config, getAppEvents, locationService } from '@grafana/runtime';
import { loadMyCompletions } from '../../completion-records/completion-read-client';
import { hasEmittedGuideCompletion, onCompletionRecorded } from '../../completion-records/completion-recorder';
import { setAutomaticLearningPolicy } from '../../global-state/automatic-learning-offers';
import { offerOrganizationGuide } from '../../global-state/organization-guide-offer';
import { kioskState } from '../../global-state/kiosk';
import { panelModeManager } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { currentPlatform } from '../../lib/platform';
import { logger } from '../../lib/logging';
import { isExtensionSidebarInUse, isExtensionSidebarOwnedByOther } from '../../lib/storage/extension-sidebar';
import {
  canIntroduceOrganizationGuide,
  organizationGuideBudgetKey,
  readOrganizationGuideBudget,
  writeOrganizationGuideBudget,
} from '../../lib/organization-guide-budget';
import { fetchPathfinderSettingsSnapshot } from '../../utils/pathfinder-settings-api';
import { parsePathfinderDeepLink } from '../../utils/pathfinder-search-params';
import { getCurrentPath } from '../../utils/sidebar-auto-open';
import pluginJson from '../../plugin.json';
import { resolveOrganizationGuide } from './resolve';

const inWizard = () => getCurrentPath().includes('/a/grafana-setupguide-app/onboarding-flow');

export function startOrganizationGuideIntroduction(): () => void {
  let stopped = false;
  let userIntent = false;
  let opened = false;
  let completed = false;
  let ownsOpening = false;
  let detachLocation = () => {};
  let unsubscribeCompletion = () => {};
  let finishOpening = () => {};
  const intent = () => {
    if (!inWizard()) {
      userIntent = true;
    }
  };
  document.addEventListener('pointerdown', intent, true);
  document.addEventListener('keydown', intent, true);
  document.addEventListener('pathfinder-auto-open-docs', intent);
  const stopLaunch = autoLaunchChannel.subscribe(intent);
  const stopSurface = onPathfinderSurfaceChange((surface) => {
    if (surface !== 'closed' && !ownsOpening) {
      intent();
    }
    if (surface === 'closed' && ownsOpening) {
      userIntent = true;
    }
  });
  const owner = `${config.namespace}:${config.bootData?.user?.id}`;
  const eligibleSurface = () => {
    const params = parsePathfinderDeepLink(window.location.search);
    return (
      !stopped &&
      !userIntent &&
      !completed &&
      document.visibilityState === 'visible' &&
      owner === `${config.namespace}:${config.bootData?.user?.id}` &&
      !inWizard() &&
      !kioskState.getSnapshot() &&
      !params.doc &&
      !params.controller &&
      !params.pathfinderKiosk &&
      panelModeManager.getMode() === 'sidebar' &&
      !isExtensionSidebarOwnedByOther(pluginJson.id)
    );
  };

  async function introduce(resourceName: string): Promise<void> {
    const path = getCurrentPath();
    if (!eligibleSurface() || sidebarState.getIsSidebarMounted() || isExtensionSidebarInUse()) {
      return;
    }
    const [guide, completions] = await Promise.all([resolveOrganizationGuide(resourceName), loadMyCompletions()]);
    if (!guide || stopped) {
      return;
    }
    const key = organizationGuideBudgetKey(config.namespace, String(config.bootData.user.id), resourceName);
    const locallyCompleted = () => hasEmittedGuideCompletion('app-platform', guide.guideId);
    completed =
      locallyCompleted() ||
      (completions.kind === 'ok' &&
        completions.data.completions.some(
          (row) =>
            row.guideSource === 'app-platform' && row.guideId === guide.guideId && row.maxCompletionPercent >= 100
        ));
    unsubscribeCompletion = onCompletionRecorded((fact) => {
      if (fact.guideSource === 'app-platform' && fact.guideId === guide.guideId) {
        completed = true;
        const budget = readOrganizationGuideBudget(localStorage, key);
        if (budget) {
          writeOrganizationGuideBudget(localStorage, key, { ...budget, completed: true });
        }
      }
    });
    if (completions.kind !== 'ok' || completed || !navigator.locks) {
      return;
    }
    await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
      if (!lock || !eligibleSurface() || getCurrentPath() !== path || locallyCompleted()) {
        return;
      }
      const budget = readOrganizationGuideBudget(localStorage, key);
      if (
        !budget ||
        !canIntroduceOrganizationGuide(budget, Date.now()) ||
        !writeOrganizationGuideBudget(localStorage, key, budget)
      ) {
        return;
      }
      const fresh = await fetchPathfinderSettingsSnapshot();
      if (
        fresh?.config.organizationGuideId !== resourceName ||
        fresh.config.pathfinderEnabled === false ||
        !eligibleSurface() ||
        locallyCompleted() ||
        getCurrentPath() !== path ||
        sidebarState.getIsSidebarMounted() ||
        isExtensionSidebarInUse()
      ) {
        return;
      }
      await new Promise<void>((resolve) => {
        let live = true;
        const timer = setTimeout(() => finishOpening(), 20_000);
        finishOpening = () => {
          live = false;
          clearTimeout(timer);
          offerOrganizationGuide(null);
          resolve();
        };
        offerOrganizationGuide({
          url: guide.url,
          title: guide.title,
          content: guide.content,
          canLaunch: () => live && eligibleSurface() && !locallyCompleted() && getCurrentPath() === path,
          rendered: () => {
            if (
              !live ||
              opened ||
              document.visibilityState !== 'visible' ||
              panelModeManager.getMode() !== 'sidebar' ||
              !sidebarState.getIsSidebarMounted() ||
              isExtensionSidebarOwnedByOther(pluginJson.id)
            ) {
              return;
            }
            const current = readOrganizationGuideBudget(localStorage, key);
            if (current && !current.completed) {
              opened = writeOrganizationGuideBudget(localStorage, key, {
                ...current,
                count: Math.min(3, current.count + 1),
                lastOpenedAt: Date.now(),
              });
            }
            finishOpening();
          },
        });
        ownsOpening = true;
        sidebarState.setPendingOpenSource('organization_guide', 'auto_open');
        getAppEvents().publish({
          type: 'open-extension-sidebar',
          payload: {
            pluginId: pluginJson.id,
            componentTitle: 'Interactive learning',
          },
        });
      });
    });
  }

  async function start(): Promise<void> {
    if (currentPlatform() !== 'cloud' || !config.namespace || !config.bootData?.user?.isSignedIn) {
      setAutomaticLearningPolicy('unrestricted');
      return;
    }
    const snapshot = await fetchPathfinderSettingsSnapshot();
    if (stopped) {
      return;
    }
    const id = snapshot?.config.organizationGuideId;
    setAutomaticLearningPolicy(id ? 'organization' : 'unrestricted');
    if (!id || snapshot?.config.pathfinderEnabled === false) {
      return;
    }
    if (inWizard()) {
      detachLocation = locationService.getHistory().listen(() => {
        if (!inWizard()) {
          detachLocation();
          void introduce(id).catch(failed);
        }
      });
    } else {
      await introduce(id);
    }
  }
  const failed = () => {
    logger.warn('Organization guide introduction suppressed', { reason: 'lookup-or-storage-failed' });
  };
  void start().catch(failed);
  return () => {
    stopped = true;
    finishOpening();
    detachLocation();
    unsubscribeCompletion();
    stopLaunch();
    stopSurface();
    document.removeEventListener('pathfinder-auto-open-docs', intent);
    document.removeEventListener('pointerdown', intent, true);
    document.removeEventListener('keydown', intent, true);
  };
}
