import type { PathfinderPluginConfig } from '../constants';

export type PathfinderAvailability = 'enabled' | 'disabled' | 'unavailable';

export async function resolvePathfinderAvailability(
  remoteEnabled: boolean,
  readSettings: () => Promise<PathfinderPluginConfig | undefined>
): Promise<PathfinderAvailability> {
  if (!remoteEnabled) {
    return 'disabled';
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const settings = await Promise.race([
      readSettings(),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), 10_000);
      }),
    ]);
    if (!settings) {
      return 'unavailable';
    }
    return settings.pathfinderEnabled === false ? 'disabled' : 'enabled';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timeout);
  }
}
