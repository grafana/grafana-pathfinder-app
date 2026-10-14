import { useCallback, useEffect, useRef, useState } from 'react';
import { locationService } from '@grafana/runtime';
import type { JsonSectionCheckpoint } from '../../../types/json-guide.types';
import { inspectCheckpoint, restoreCheckpoint, type CheckpointResult } from '../../../recovery/section-checkpoint';
import { createCheckpointAdapter, useGuideRequirements } from '../../../requirements-manager';

const NAVIGATION_SETTLE_MS = 750;

export type SectionCheckpointEvent =
  | { kind: 'paused'; result: CheckpointResult }
  | { kind: 'restore'; outcome: 'restored' | 'failed' | 'cancelled'; durationMs: number; result?: CheckpointResult };

function currentPath(): string {
  const { pathname, search } = locationService.getLocation();
  return pathname + search;
}

export function useSectionCheckpoint(
  checkpoint: JsonSectionCheckpoint | undefined,
  sectionId: string,
  enabled: boolean,
  controllerMode: boolean,
  onEvent?: (event: SectionCheckpointEvent) => void
) {
  const { checkPostconditions } = useGuideRequirements();
  const [status, setStatus] = useState<CheckpointResult | null>(null);
  const [restoring, setRestoring] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const busyRestoring = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const lastReadyUrl = useRef<string | undefined>(undefined);
  const pauseReported = useRef(false);
  const restoreStartedAt = useRef(0);

  const run = useCallback(
    (restore: boolean): Promise<boolean> => {
      if (busy.current && (!restore || busyRestoring.current)) {
        return inFlight.current ?? Promise.resolve(false);
      }
      const execute = async (): Promise<boolean> => {
        if (!checkpoint) {
          return true;
        }
        operation.current?.abort();
        const controller = new AbortController();
        operation.current = controller;
        if (!enabled || controllerMode) {
          setStatus({
            passed: false,
            canRestore: false,
            explanation: controllerMode
              ? 'Open this guide in the Grafana tab to restore its checkpoint.'
              : 'Complete the section prerequisites before restoring this checkpoint.',
          });
          return false;
        }
        busy.current = true;
        busyRestoring.current = restore;
        restoreStartedAt.current = performance.now();
        setRestoring(restore);
        const adapter = createCheckpointAdapter(
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
          {
            lastReadyUrl: () => lastReadyUrl.current,
            replay: async (step) => {
              const { ButtonHandler, NavigateHandler, NavigationManager, InteractiveStateManager } =
                await import('../../../interactive-engine');
              if (controller.signal.aborted) {
                return false;
              }
              const stateManager = new InteractiveStateManager();
              const handler =
                step.action === 'button'
                  ? new ButtonHandler(stateManager, new NavigationManager(), async () => {})
                  : new NavigateHandler(stateManager, async () => {});
              const result = await handler.executeRecovery({
                targetAction: step.action,
                refTarget: step.reftarget,
                targetState: step.targetstate,
                signal: controller.signal,
                tagName: 'button',
              });
              return result.outcome === 'ok';
            },
          }
        );
        try {
          const result = restore
            ? await restoreCheckpoint(checkpoint, adapter, controller.signal)
            : await inspectCheckpoint(checkpoint, adapter, controller.signal);
          if (controller.signal.aborted) {
            return false;
          }
          setStatus(result);
          if (result.passed) {
            lastReadyUrl.current = currentPath();
            pauseReported.current = false;
          } else if (!pauseReported.current) {
            pauseReported.current = true;
            onEvent?.({ kind: 'paused', result });
          }
          if (restore) {
            onEvent?.({
              kind: 'restore',
              outcome: result.passed ? 'restored' : 'failed',
              durationMs: Math.round(performance.now() - restoreStartedAt.current),
              result,
            });
          }
          return result.passed;
        } catch {
          if (!controller.signal.aborted) {
            setStatus({
              passed: false,
              canRestore: false,
              explanation: 'The section state could not be verified. Check again when the page is ready.',
            });
          }
          return false;
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
    [checkpoint, enabled, controllerMode, checkPostconditions, sectionId, onEvent]
  );

  useEffect(() => {
    if (!checkpoint) {
      return;
    }
    void run(false);
    const recheck = () => {
      void run(false);
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
      pauseReported.current = false;
      setStatus(null);
      clearInterval(timer);
      clearTimeout(settle);
      unlisten();
      window.removeEventListener('focus', recheck);
    };
  }, [checkpoint, run]);

  const cancel = useCallback(() => {
    if (busy.current && busyRestoring.current) {
      onEvent?.({
        kind: 'restore',
        outcome: 'cancelled',
        durationMs: Math.round(performance.now() - restoreStartedAt.current),
      });
    }
    operation.current?.abort();
    operation.current = null;
    inFlight.current = null;
    busy.current = false;
    setRestoring(false);
    setStatus({
      passed: false,
      canRestore: true,
      explanation: 'Recovery stopped. You can keep exploring or restore the section when ready.',
    });
  }, [onEvent]);
  const recheck = useCallback(() => run(false), [run]);
  const restore = useCallback(() => run(true), [run]);
  return {
    status: status ?? { passed: !checkpoint, canRestore: false },
    settled: status !== null,
    restoring,
    cancel,
    recheck,
    restore,
    passed: !checkpoint || (enabled && !controllerMode && !!status?.passed && !restoring),
  };
}
