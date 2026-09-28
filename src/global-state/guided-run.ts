export interface GuidedRun {
  signal: AbortSignal;
  cancel: () => void;
  release: () => void;
}

let activeRun: GuidedRun | null = null;

export function acquireGuidedRun(): GuidedRun | null {
  if (activeRun) {
    return null;
  }
  const controller = new AbortController();
  const run: GuidedRun = {
    signal: controller.signal,
    cancel: () => {
      controller.abort();
      run.release();
    },
    release: () => {
      if (activeRun === run) {
        activeRun = null;
      }
    },
  };
  activeRun = run;
  return run;
}
