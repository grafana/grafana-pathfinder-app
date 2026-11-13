export type TestMode = 'single' | 'all' | 'path' | 'kiosk';

export interface TestModeContext {
  hasKiosks?: boolean;
  hasContent?: boolean;
  /** Manifests are still being fetched, so path availability is not yet known. */
  manifestsLoading: boolean;
  /** The PR contains at least one path/journey manifest. */
  hasAnyPathPackage: boolean;
}

/**
 * Clamp a persisted test mode to one the current PR can honor. The skip while
 * manifests load is load-bearing: `hasAnyPathPackage` is still false mid-fetch
 * for a genuine path PR, so clamping then would drop a valid 'path' selection.
 */
export function resolveEffectiveTestMode(testMode: TestMode, ctx: TestModeContext): TestMode {
  if (ctx.hasKiosks && ctx.hasContent === false && !ctx.hasAnyPathPackage) {
    return 'kiosk';
  }
  if (testMode === 'kiosk' && !ctx.hasKiosks) {
    return 'single';
  }
  if (!['single', 'all', 'path', 'kiosk'].includes(testMode)) {
    return ctx.hasKiosks ? 'kiosk' : 'single';
  }
  if (!ctx.manifestsLoading && testMode === 'path' && !ctx.hasAnyPathPackage) {
    return 'single';
  }
  return testMode;
}
