import { acquireGuidedRun, type GuidedRun } from '../../global-state/guided-run';
import { GuidedHandler, InteractiveStateManager, NavigationManager } from '../../interactive-engine';
import { waitForReactUpdates } from '../../lib/async-utils';

interface GuidedSessionState {
  isExecuting: boolean;
  currentStepIndex: number;
  failedStepIndex: number;
  currentStepStatus: 'waiting' | 'timeout' | 'completed';
  executionError: string | null;
  wasCancelled: boolean;
}

let activeSession: ReturnType<typeof createGuidedSession> | null = null;

export function getGuidedSession(key: string) {
  return activeSession?.key === key && activeSession.runRef.current && !activeSession.runRef.current.signal.aborted
    ? activeSession
    : createGuidedSession(key);
}

function createGuidedSession(key: string) {
  let state: GuidedSessionState = {
    isExecuting: false,
    currentStepIndex: 0,
    failedStepIndex: -1,
    currentStepStatus: 'waiting',
    executionError: null,
    wasCancelled: false,
  };
  const listeners = new Set<() => void>();
  const hosts = new Set<symbol>();
  let transferTimer: ReturnType<typeof setTimeout> | undefined;
  const handler = new GuidedHandler(new InteractiveStateManager(), new NavigationManager(), waitForReactUpdates);
  const runRef: { current: GuidedRun | null } = { current: null };
  const isExecutingRef = { current: false };
  const update = <K extends keyof GuidedSessionState>(field: K, value: GuidedSessionState[K]) => {
    state = { ...state, [field]: value };
    listeners.forEach((listener) => listener());
  };
  const clearTransfer = () => {
    clearTimeout(transferTimer);
    transferTimer = undefined;
  };
  const cancel = () => {
    clearTransfer();
    runRef.current?.cancel();
    handler.cancel();
    if (activeSession === session) {
      activeSession = null;
    }
  };
  let complete = () => {};
  const session = {
    key,
    handler,
    runRef,
    isExecutingRef,
    complete: () => complete(),
    bindCompletion: (callback: () => void) => {
      complete = callback;
    },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setIsExecuting: (value: boolean) => update('isExecuting', value),
    setCurrentStepIndex: (value: number) => update('currentStepIndex', value),
    setFailedStepIndex: (value: number) => update('failedStepIndex', value),
    setCurrentStepStatus: (value: GuidedSessionState['currentStepStatus']) => update('currentStepStatus', value),
    setExecutionError: (value: string | null) => update('executionError', value),
    setWasCancelled: (value: boolean) => update('wasCancelled', value),
    acquire: () => {
      const run = acquireGuidedRun();
      if (run) {
        runRef.current = run;
        activeSession = session;
      }
      return run;
    },
    release: (run: GuidedRun) => {
      run.release();
      if (runRef.current === run) {
        clearTransfer();
        runRef.current = null;
        if (activeSession === session) {
          activeSession = null;
        }
      }
    },
    attach: (host: symbol) => {
      hosts.add(host);
      clearTransfer();
      listeners.forEach((listener) => listener());
    },
    detach: (host: symbol, transferring: boolean) => {
      hosts.delete(host);
      if (hosts.size > 0) {
        return;
      }
      if (transferring && runRef.current && !runRef.current.signal.aborted) {
        // A failed navigation must not leave an invisible tour holding the tab lease.
        clearTransfer();
        transferTimer = setTimeout(cancel, 3000);
      } else {
        cancel();
      }
    },
    waitForHost: async (signal: AbortSignal) => {
      signal.throwIfAborted();
      if (hosts.size > 0) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          listeners.delete(checkHost);
          signal.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
          cleanup();
          reject(signal.reason);
        };
        const checkHost = () => {
          if (hosts.size > 0) {
            cleanup();
            resolve();
          }
        };
        listeners.add(checkHost);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    cancel,
  };
  return session;
}
