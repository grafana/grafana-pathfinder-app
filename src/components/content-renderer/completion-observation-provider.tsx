import {
  saveObservationHandoff,
  takeObservationHandoff,
  OBSERVATION_HANDOFF_EVENT,
} from '../../global-state/observation/handoff';
import {
  REQUEST_SIDEBAR_HANDOFF_EVENT,
  PANEL_MODE_CHANGE_EVENT,
  StorageEvents,
  TERMINAL_STATUS_CHANGED_EVENT,
} from '../../lib/event-names';
import { resolveGuideContentKey } from '../../global-state/guide-content-key';
import { usePathfinderPluginConfig } from '../../hooks';
import { getFeatureFlagValue } from '../../utils/openfeature';
import React, { useEffect, useMemo, type PropsWithChildren } from 'react';
import { CompletionCoordinator } from '../../global-state/observation/coordinator';
import { CompletionObservationContext } from '../../global-state/observation/context';
import { useGuideRequirements, splitGuideScopedRequirements } from '../../requirements-manager';
import { conditionTokens } from '../../lib/condition-input';
import { onContextChange } from '../../lib/context-event-bus';
import { subscribeProgressEvent } from '../../global-state/progress-events';
import { useInteractiveMode } from '../../global-state/interactive-mode-context';
import { useControllerChannel, useControllerConnected } from '../../global-state/controller-channel';
import {
  matchesFormfillState,
  matchesPassiveAction,
  observePassiveActions,
  matchesPassiveNavigation,
  observePassiveNavigation,
} from '../../interactive-engine';

let observationGeneration = 0;
const POLL_MS = 5000;
const MAX_POLL_MS = 60_000;
const ACTIVITY_MS = 250;

export function CompletionObservationProvider({ children, contentKey }: PropsWithChildren<{ contentKey: string }>) {
  const { checkPostconditions } = useGuideRequirements();
  const mode = useInteractiveMode();
  const channel = useControllerChannel();
  const connected = useControllerConnected();
  const { config } = usePathfinderPluginConfig();
  const enabled = config.enableAutoDetection !== false && getFeatureFlagValue('pathfinder.passive-completion', true);
  const coordinator = useMemo(() => {
    const inFlight = new Map<string, Promise<boolean>>();
    const overdue = new Set<string>();
    return new CompletionCoordinator(async (conditions, step, signal) => {
      const action = step.actions[0];
      const options = {
        requirements: conditions,
        stepId: step.stepId,
        targetAction: action?.targetAction,
        refTarget: action?.refTarget,
        targetValue: action?.targetValue,
        lazyRender: false,
        maxRetries: 0,
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const evaluate = async () => {
        if (mode !== 'controller') {
          return (await checkPostconditions(options)).verdict === 'satisfied';
        }
        if (!channel) {
          return false;
        }
        const { guideScoped, remaining } = splitGuideScopedRequirements(conditions);
        const local =
          !conditionTokens(guideScoped).length ||
          (await checkPostconditions({ ...options, requirements: guideScoped })).verdict === 'satisfied';
        if (!local) {
          return false;
        }
        if (!conditionTokens(remaining).length) {
          return true;
        }
        const remote = await channel.requestRequirementCheck(step.stepId, remaining, { ...options, passive: true });
        return remote !== null && remote.verdict === 'satisfied';
      };
      const key = JSON.stringify([conditions, step.actions[0]]);
      let pending = inFlight.get(key);
      if (!pending) {
        if (inFlight.size - overdue.size >= 4) {
          return false;
        }
        pending = evaluate().finally(() => {
          inFlight.delete(key);
          overdue.delete(key);
        });
        inFlight.set(key, pending);
      }
      let onAbort = () => {};
      try {
        return await Promise.race([
          new Promise<boolean>((resolve) => {
            onAbort = () => resolve(false);
            if (signal.aborted) {
              onAbort();
            } else {
              signal.addEventListener('abort', onAbort, { once: true });
            }
          }),
          pending,
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), 4000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (inFlight.get(key) === pending) {
          overdue.add(key);
        }
      }
    });
  }, [checkPostconditions, mode, channel]);

  useEffect(() => {
    if (!enabled || (mode !== 'controller' && new URLSearchParams(window.location.search).get('controller') === '1')) {
      return;
    }
    coordinator.restore(takeObservationHandoff(contentKey));
    coordinator.start();
    let pollDelay = POLL_MS;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const recheckIfVisible = () => {
      if (mode === 'controller' || document.visibilityState !== 'hidden') {
        coordinator.recheck();
      }
    };
    const schedulePoll = () => {
      clearTimeout(poll);
      poll = setTimeout(() => {
        pollDelay = Math.min(pollDelay * 2, MAX_POLL_MS);
        recheckIfVisible();
        schedulePoll();
      }, pollDelay);
    };
    const visibleCheck = () => {
      pollDelay = POLL_MS;
      schedulePoll();
      recheckIfVisible();
    };
    const unsubscribeContext = onContextChange(visibleCheck);
    const unsubscribeProgress = subscribeProgressEvent((event) => {
      if (event.kind !== 'guide' && !event.completed) {
        coordinator.resetScope(event.kind === 'step' ? event.stepId : undefined, event.sectionId);
      } else {
        visibleCheck();
      }
    });
    let activity: ReturnType<typeof setTimeout> | undefined;
    const observeActions = () =>
      mode === 'interactive'
        ? observePassiveActions(
            (event) => {
              coordinator.observe((action) => matchesPassiveAction(action, event));
              if (event.type !== 'mouseover') {
                clearTimeout(activity);
                activity = setTimeout(visibleCheck, ACTIVITY_MS);
              }
            },
            (touched) => coordinator.observe((action) => matchesFormfillState(action, touched))
          )
        : () => {};
    let observe = observeActions();
    let generation = coordinator.generation;
    const unsubscribeGeneration = coordinator.subscribe(() => {
      if (generation !== coordinator.generation) {
        generation = coordinator.generation;
        observe();
        observe = observeActions();
      }
    });
    const saveHandoff = () => saveObservationHandoff(contentKey, coordinator.exportCursors());
    const handoff = () => {
      saveHandoff();
      coordinator.stop();
    };
    const restoreHandoff = (event: StorageEvent) => {
      if (event.key === OBSERVATION_HANDOFF_EVENT && mode === 'controller') {
        const cursors = takeObservationHandoff(contentKey);
        if (Object.keys(cursors).length) {
          coordinator.restore(cursors);
          coordinator.recheck();
        }
      }
    };
    window.addEventListener('storage', restoreHandoff);
    const handleReset = (event: Event) => {
      const key = (event as CustomEvent<{ contentKey?: string }>).detail?.contentKey;
      if (!key || key === '*') {
        coordinator.reset(undefined, 'all');
      } else if (key === resolveGuideContentKey(contentKey)) {
        coordinator.reset();
      }
    };
    const history =
      mode === 'interactive'
        ? observePassiveNavigation(() => {
            coordinator.observe(matchesPassiveNavigation);
            visibleCheck();
          })
        : () => {};
    document.addEventListener(OBSERVATION_HANDOFF_EVENT, handoff);
    document.addEventListener(REQUEST_SIDEBAR_HANDOFF_EVENT, saveHandoff);
    document.addEventListener(PANEL_MODE_CHANGE_EVENT, saveHandoff);
    if (mode === 'controller') {
      window.addEventListener('pagehide', saveHandoff);
    }
    window.addEventListener(StorageEvents.InteractiveProgressCleared, handleReset);
    schedulePoll();
    window.addEventListener('popstate', visibleCheck);
    window.addEventListener('hashchange', visibleCheck);
    window.addEventListener('focus', visibleCheck);
    window.addEventListener(TERMINAL_STATUS_CHANGED_EVENT, visibleCheck);
    document.addEventListener('visibilitychange', visibleCheck);
    return () => {
      coordinator.stop();
      window.removeEventListener('storage', restoreHandoff);
      history();
      document.removeEventListener(OBSERVATION_HANDOFF_EVENT, handoff);
      document.removeEventListener(REQUEST_SIDEBAR_HANDOFF_EVENT, saveHandoff);
      document.removeEventListener(PANEL_MODE_CHANGE_EVENT, saveHandoff);
      window.removeEventListener('pagehide', saveHandoff);
      window.removeEventListener(StorageEvents.InteractiveProgressCleared, handleReset);
      unsubscribeContext();
      unsubscribeProgress();
      unsubscribeGeneration();
      observe();
      clearTimeout(activity);
      clearTimeout(poll);
      window.removeEventListener('popstate', visibleCheck);
      window.removeEventListener('hashchange', visibleCheck);
      window.removeEventListener('focus', visibleCheck);
      window.removeEventListener(TERMINAL_STATUS_CHANGED_EVENT, visibleCheck);
      document.removeEventListener('visibilitychange', visibleCheck);
    };
  }, [coordinator, mode, contentKey, enabled]);
  useEffect(() => {
    if (!enabled || mode !== 'controller' || !channel || !connected) {
      return;
    }
    let generation = coordinator.generation;
    let subscriptionId = crypto.randomUUID();
    let subscriptionGeneration = ++observationGeneration;
    let release = () => {};
    const listen = () =>
      channel.onObservation(subscriptionId, (evidence) => {
        if (evidence.guideKey === contentKey) {
          if (evidence.kind === 'observation-evidence') {
            coordinator.observeIndex(evidence.id, evidence.index);
          }
          coordinator.recheck();
        }
      });
    release = listen();
    const publish = () => {
      if (generation !== coordinator.generation) {
        channel.post({ kind: 'observation-cancel', subscriptionId });
        release();
        subscriptionId = crypto.randomUUID();
        subscriptionGeneration = ++observationGeneration;
        generation = coordinator.generation;
        release = listen();
      }
      channel.post({
        kind: 'observation-subscribe',
        generation: subscriptionGeneration,
        subscriptionId,
        guideKey: contentKey,
        revision: coordinator.snapshot(),
        steps: coordinator.pendingActions(),
      });
    };
    publish();
    const unsubscribe = coordinator.subscribe(publish);
    const heartbeat = setInterval(publish, 2000);
    coordinator.recheck();
    return () => {
      clearInterval(heartbeat);
      unsubscribe();
      release();
      channel.post({ kind: 'observation-cancel', subscriptionId });
    };
  }, [channel, connected, contentKey, coordinator, mode, enabled]);
  useEffect(() => {
    if (mode === 'controller') {
      coordinator.invalidate();
    }
  }, [connected, coordinator, mode]);
  return (
    <CompletionObservationContext.Provider value={enabled ? coordinator : null}>
      {children}
    </CompletionObservationContext.Provider>
  );
}
