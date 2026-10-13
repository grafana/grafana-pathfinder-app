import { useCallback, useEffect, useRef, useState } from 'react';
import type { JsonSectionCheckpoint } from '../../../types/json-guide.types';
import { inspectCheckpoint, restoreCheckpoint, type CheckpointResult } from '../../../recovery/section-checkpoint';
import { createCheckpointAdapter, useGuideRequirements } from '../../../requirements-manager';

export function useSectionCheckpoint(
  checkpoint: JsonSectionCheckpoint | undefined,
  sectionId: string,
  enabled: boolean,
  controllerMode: boolean
) {
  const { checkPostconditions } = useGuideRequirements();
  const [status, setStatus] = useState<CheckpointResult>({ passed: !checkpoint, canRestore: false });
  const [restoring, setRestoring] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const run = useCallback(
    (restore: boolean): Promise<boolean> => {
      if (busy.current) {
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
          controller.signal
        );
        try {
          const result = restore
            ? await restoreCheckpoint(checkpoint, adapter, controller.signal)
            : await inspectCheckpoint(checkpoint, adapter, controller.signal);
          if (!controller.signal.aborted) {
            setStatus(result);
          }
          return !controller.signal.aborted && result.passed;
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
      return task;
    },
    [checkpoint, enabled, controllerMode, checkPostconditions, sectionId]
  );

  useEffect(() => {
    if (!checkpoint) {
      return;
    }
    void run(false);
    const recheck = () => {
      void run(false);
    };
    const timer = setInterval(recheck, 5000);
    window.addEventListener('popstate', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      operation.current?.abort();
      operation.current = null;
      busy.current = false;
      clearInterval(timer);
      window.removeEventListener('popstate', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [checkpoint, run]);

  const cancel = useCallback(() => {
    operation.current?.abort();
    operation.current = null;
    busy.current = false;
    setRestoring(false);
    setStatus({
      passed: false,
      canRestore: true,
      explanation: 'Recovery stopped. You can keep exploring or restore the section when ready.',
    });
  }, []);
  const recheck = useCallback(() => run(false), [run]);
  const restore = useCallback(() => run(true), [run]);
  return {
    status,
    restoring,
    cancel,
    recheck,
    restore,
    passed: !checkpoint || (enabled && !controllerMode && status.passed && !restoring),
  };
}
