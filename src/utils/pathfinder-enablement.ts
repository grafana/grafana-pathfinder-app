import { TenantSettingsReadError } from './resolve-tenant-settings';
import { logger } from '../lib/logging';
import type { PathfinderPluginConfig } from '../constants';

export type StartupSettingsOutcome = 'resolved' | 'read-error' | 'timeout' | 'remote-disabled';
let startupDecision: { durationMs: number; outcome: StartupSettingsOutcome } = {
  durationMs: 0,
  outcome: 'remote-disabled',
};

export function getPathfinderStartupDecision() {
  return startupDecision;
}

export type PathfinderAvailability = 'enabled' | 'disabled';

export function isImageRendererSession(search: string): boolean {
  return new URLSearchParams(search).get('render') === '1';
}

export async function resolvePathfinderAvailability(
  remoteEnabled: boolean,
  readSettings: () => Promise<PathfinderPluginConfig | undefined>
): Promise<PathfinderAvailability> {
  if (!remoteEnabled) {
    startupDecision = { durationMs: 0, outcome: 'remote-disabled' };
    return 'disabled';
  }

  const start = performance.now();
  const timedOut = Symbol('timeout');
  let outcome: StartupSettingsOutcome = 'resolved';
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Registrations stay fixed for this page; late settings still gate configured features.
    const settings = await Promise.race([
      readSettings(),
      new Promise<typeof timedOut>((resolve) => {
        timeout = setTimeout(() => resolve(timedOut), 3_000);
      }),
    ]);
    if (settings === timedOut) {
      outcome = 'timeout';
      return 'enabled';
    }
    if (!settings) {
      outcome = 'read-error';
    }
    return settings?.pathfinderEnabled === false ? 'disabled' : 'enabled';
  } catch (error) {
    outcome = 'read-error';
    return error instanceof TenantSettingsReadError && error.pathfinderEnabled === false ? 'disabled' : 'enabled';
  } finally {
    clearTimeout(timeout);
    startupDecision = { durationMs: performance.now() - start, outcome };
    logger.info('Pathfinder startup settings decision', startupDecision);
  }
}
