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
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gaveUp = useRef<{ key: string; index?: number } | null>(null);
  const pausedNow = useRef(false);
  const mounted = useRef(true);
  const restoreStartedAt = useRef(0);
  const planRef = useRef(plan);
  const latestRun = useRef<(restore: boolean) => Promise<boolean>>(async () => true);
  const gate = useRef({ enabled, controllerMode, suspended });
  useLayoutEffect(() => {
    planRef.current = plan;
    gate.current = { enabled, controllerMode, suspended };
  });

  const endPause = useCallback(
    (resolvedBy: RecoveryResolvedBy) => {
      pendingSince.current = null;
      if (pausedNow.current) {
        pausedNow.current = false;
        setPaused(false);
        onEvent?.({ kind: 'resolved', resolvedBy }, planRef.current);
      }
    },
    [onEvent]
  );

  const run = useCallback(
    (restore: boolean): Promise<boolean> => {
      if (busy.current && (!restore || busyRestoring.current)) {
        return inFlight.current ?? Promise.resolve(true);
      }
      const observe = (current: SectionRecoveryPlan, result: RecoveryResult, restored: boolean): boolean => {
        if (result.passed) {
          armedKey.current = current.key;
          lastReadyUrl.current = currentPath();
          gaveUp.current = null;
          endPause(restored ? 'restore' : 'self');
          return true;
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
          return true;
        }
        if (pausedNow.current) {
          return false;
        }
        const now = Date.now();
        if (pendingSince.current === null) {
          pendingSince.current = now;
          clearTimeout(confirmTimer.current);
          confirmTimer.current = setTimeout(() => void latestRun.current(false), NAVIGATION_SETTLE_MS);
        } else if (now - pendingSince.current >= CONFIRM_MS) {
          pausedNow.current = true;
          setPaused(true);
          onEvent?.(
            {
              kind: 'paused',
              check: current.checks[result.checkIndex ?? 0]!,
              locationRestore: leftLastReadyPage(lastReadyUrl.current),
            },
            planRef.current
          );
        }
        return false;
      };
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
          return true;
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
          const result = restore
            ? await restoreRecovery(current.checks, adapter, controller.signal)
            : await inspectRecovery(current.checks, adapter, controller.signal);
          if (controller.signal.aborted) {
            return true;
          }
          if (restore) {
            onEvent?.(
              {
                kind: 'restore',
                outcome: result.passed ? 'restored' : 'failed',
                durationMs: Math.round(performance.now() - restoreStartedAt.current),
                failure: result.failure,
              },
              planRef.current
            );
          }
          return observe(current, result, restore);
        } catch {
          return true;
        } finally {
          if (operation.current === controller) {
            busy.current = false;
            if (!controller.signal.aborted) {
              setRestoring(false);
            }
          }
        }
      };
      const task = execute();
      inFlight.current = task;
      const release = () => {
        if (inFlight.current === task) {
          inFlight.current = null;
        }
      };
      void task.then(release, release);
      return task;
    },
    [checkPostconditions, sectionId, onEvent, endPause]
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
      recheck();
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
      onEvent?.(
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
  }, [onEvent]);
  const recheck = useCallback(() => run(false), [run]);
  const restore = useCallback(() => run(true), [run]);
  return { paused, restoring, cancel, recheck, restore };
}
