import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { locationService } from '@grafana/runtime';
import {
  inspectRecovery,
  restoreRecovery,
  type RecoveryFailure,
  type RecoveryResult,
} from '../../../recovery/section-recovery';
import type { RecoveryCheck, SectionRecoveryPlan } from '../../../recovery/section-recovery-plan';
import { createRecoveryAdapter, useGuideRequirements } from '../../../requirements-manager';

const NAVIGATION_SETTLE_MS = 750;
const CONFIRM_MS = 700;

export type RecoveryResolvedBy = 'restore' | 'self' | 'step_completed' | 'unrestorable' | 'inactive' | 'unmount';

export type SectionRecoveryEvent =
  | { kind: 'paused'; check: RecoveryCheck; locationRestore: boolean }
  | { kind: 'restore'; outcome: 'restored' | 'failed' | 'cancelled'; durationMs: number; failure?: RecoveryFailure }
  | { kind: 'resolved'; resolvedBy: RecoveryResolvedBy };

function currentPath(): string {
  const { pathname, search } = locationService.getLocation();
  return pathname + search;
}

function leftLastReadyPage(lastReadyUrl: string | undefined): boolean {
  return (
    !!lastReadyUrl && new URL(lastReadyUrl, window.location.origin).pathname !== locationService.getLocation().pathname
  );
}

export function useSectionRecovery(
  plan: SectionRecoveryPlan | undefined,
  sectionId: string,
  enabled: boolean,
  controllerMode: boolean,
  {
    onEvent,
    suspended = false,
  }: {
    onEvent?: (event: SectionRecoveryEvent, plan: SectionRecoveryPlan | undefined) => void;
    suspended?: boolean;
  } = {}
) {
  const { checkPostconditions } = useGuideRequirements();
  const [paused, setPaused] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const busyRestoring = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const lastReadyUrl = useRef<string | undefined>(undefined);
  const armedKey = useRef<string | undefined>(undefined);
  const pendingSince = useRef<number | null>(null);
  const settlingUntil = useRef(0);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gaveUp = useRef<{ key: string; index?: number } | null>(null);
  const pausedNow = useRef(false);
  const lastAnswer = useRef(true);
  const mounted = useRef(true);
  const restoreStartedAt = useRef(0);
  const planRef = useRef(plan);
  const onEventRef = useRef(onEvent);
  const latestRun = useRef<(restore: boolean) => Promise<boolean>>(async () => true);
  const gate = useRef({ enabled, controllerMode, suspended });
  useLayoutEffect(() => {
    planRef.current = plan;
    onEventRef.current = onEvent;
    gate.current = { enabled, controllerMode, suspended };
  });

  const endPause = useCallback((resolvedBy: RecoveryResolvedBy) => {
    pendingSince.current = null;
    if (pausedNow.current) {
      pausedNow.current = false;
      setPaused(false);
      onEventRef.current?.({ kind: 'resolved', resolvedBy }, planRef.current);
    }
  }, []);

  const run = useCallback(
    (restore: boolean): Promise<boolean> => {
      if (busy.current && (!restore || busyRestoring.current)) {
        return inFlight.current ?? Promise.resolve(lastAnswer.current);
      }
      const answer = (ready: boolean): boolean => {
        lastAnswer.current = ready;
        return ready;
      };
      const observe = (
        current: SectionRecoveryPlan,
        result: RecoveryResult,
        restored: boolean,
        startedOnPath: string
      ): boolean => {
        if (result.passed) {
          armedKey.current = current.key;
          if (locationService.getLocation().pathname === startedOnPath) {
            lastReadyUrl.current = currentPath();
          }
          gaveUp.current = null;
          endPause(restored ? 'restore' : 'self');
          return answer(true);
        }
        if (result.gaveUp) {
          gaveUp.current = { key: current.key, index: result.checkIndex };
        } else if (
          gaveUp.current &&
          (gaveUp.current.key !== current.key || gaveUp.current.index !== result.checkIndex)
        ) {
          gaveUp.current = null;
        }
        if (armedKey.current !== current.key || !result.canRestore || gaveUp.current) {
          endPause('unrestorable');
          return answer(true);
        }
        if (pausedNow.current) {
          return answer(false);
        }
        if (gate.current.suspended) {
          pendingSince.current = null;
          clearTimeout(confirmTimer.current);
          return answer(false);
        }
        const now = Date.now();
        if (pendingSince.current === null) {
          pendingSince.current = now;
          clearTimeout(confirmTimer.current);
          confirmTimer.current = setTimeout(() => void latestRun.current(false), NAVIGATION_SETTLE_MS);
        } else if (now - pendingSince.current >= CONFIRM_MS) {
          pausedNow.current = true;
          setPaused(true);
          onEventRef.current?.(
            {
              kind: 'paused',
              check: current.checks[result.checkIndex ?? 0]!,
              locationRestore: leftLastReadyPage(lastReadyUrl.current),
            },
            planRef.current
          );
        }
        return answer(false);
      };
      let task: Promise<boolean> | undefined;
      const execute = async (): Promise<boolean> => {
        const current = planRef.current;
        if (!current) {
          return true;
        }
        operation.current?.abort();
        const controller = new AbortController();
        operation.current = controller;
        if (!gate.current.enabled || gate.current.controllerMode) {
          endPause('inactive');
          return answer(true);
        }
        busy.current = true;
        busyRestoring.current = restore;
        restoreStartedAt.current = performance.now();
        setRestoring(restore);
        const adapter = createRecoveryAdapter(
          checkPostconditions,
          async () => {
            const { NavigationManager } = await import('../../../interactive-engine');
            const navigationManager = new NavigationManager();
            return {
              stepId: sectionId,
              navigationManager,
              fixNavigationRequirements: () => navigationManager.fixNavigationRequirements(),
            };
          },
          controller.signal,
          () => lastReadyUrl.current
        );
        try {
          const settleLeft = settlingUntil.current - Date.now();
          if (!restore && settleLeft > 0) {
            await new Promise((resolve) => setTimeout(resolve, settleLeft));
          }
          const startedOnPath = locationService.getLocation().pathname;
          const result = restore
            ? await restoreRecovery(current.checks, adapter, controller.signal)
            : await inspectRecovery(current.checks, adapter, controller.signal);
          if (controller.signal.aborted) {
            return inFlight.current && inFlight.current !== task ? inFlight.current : lastAnswer.current;
          }
          if (restore) {
            onEventRef.current?.(
              {
                kind: 'restore',
                outcome: result.passed ? 'restored' : 'failed',
                durationMs: Math.round(performance.now() - restoreStartedAt.current),
                failure: result.failure,
              },
              planRef.current
            );
          }
          return observe(current, result, restore, startedOnPath);
        } catch {
          return lastAnswer.current;
        } finally {
          if (operation.current === controller) {
            busy.current = false;
            if (!controller.signal.aborted) {
              setRestoring(false);
            }
          }
        }
      };
      task = execute();
      const settled = task;
      inFlight.current = settled;
      const release = () => {
        if (inFlight.current === settled) {
          inFlight.current = null;
        }
      };
      void settled.then(release, release);
      return settled;
    },
    [checkPostconditions, sectionId, endPause]
  );

  useLayoutEffect(() => {
    latestRun.current = run;
  }, [run]);

  const planKey = plan?.key;

  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  useEffect(() => () => endPause(mounted.current ? 'step_completed' : 'unmount'), [planKey, endPause]);

  useEffect(() => {
    if (planKey && !suspended) {
      void run(false);
    }
  }, [planKey, run, enabled, controllerMode, suspended]);

  useEffect(() => {
    if (!planKey) {
      return;
    }
    const recheck = () => {
      if (!gate.current.suspended) {
        void run(false);
      }
    };
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onNavigate = () => {
      settlingUntil.current = Date.now() + NAVIGATION_SETTLE_MS;
      clearTimeout(settle);
      settle = setTimeout(recheck, NAVIGATION_SETTLE_MS);
    };
    const timer = setInterval(recheck, 5000);
    const unlisten = locationService.getHistory().listen(onNavigate);
    window.addEventListener('focus', recheck);
    return () => {
      operation.current?.abort();
      operation.current = null;
      inFlight.current = null;
      busy.current = false;
      pendingSince.current = null;
      clearTimeout(confirmTimer.current);
      clearInterval(timer);
      clearTimeout(settle);
      unlisten();
      window.removeEventListener('focus', recheck);
    };
  }, [planKey, run]);

  const cancel = useCallback(() => {
    if (busy.current && busyRestoring.current) {
      onEventRef.current?.(
        {
          kind: 'restore',
          outcome: 'cancelled',
          durationMs: Math.round(performance.now() - restoreStartedAt.current),
        },
        planRef.current
      );
    }
    operation.current?.abort();
    operation.current = null;
    inFlight.current = null;
    busy.current = false;
    setRestoring(false);
  }, []);
  const recheck = useCallback(() => run(false), [run]);
  const restore = useCallback(() => run(true), [run]);
  return { paused, restoring, cancel, recheck, restore };
}
