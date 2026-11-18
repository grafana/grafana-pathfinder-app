import { firstValueFrom, timeout } from 'rxjs';
import { config, getBackendSrv } from '@grafana/runtime';
import { PLUGIN_BACKEND_URL } from '../constants';

let registeredCloudNamespace: string | undefined;

export function usesSdkBackend(): boolean {
  const toggles = config?.featureToggles as Record<string, boolean> | undefined;
  return (
    Boolean(config?.namespace) &&
    config.namespace !== '*' &&
    (config.namespace === registeredCloudNamespace ||
      (toggles?.['appplugins.loadAppManifest'] === true && toggles?.['appplugins.registerAPIServer'] === true))
  );
}

const backendPaths = [
  'pathfinder-settings',
  'custom-guide',
  'custom-guides',
  'custom-guide-repository',
  'completion-records',
  'completion-records/my',
  'completion-records/capability',
  'assignments/my',
  'learning-insights',
  'package-recommendations',
  'health',
  'api/v1/achievements/events',
  'api/v1/achievements/my',
  'api/v1/achievements/definitions',
] as const;

export function backendRoute(path: (typeof backendPaths)[number], sdk = usesSdkBackend()): string {
  if (!(backendPaths as readonly string[]).includes(path)) {
    throw new Error('Unknown backend route');
  }
  if (!sdk) {
    return `${PLUGIN_BACKEND_URL}/${path}`;
  }
  return `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${encodeURIComponent(config.namespace)}/backend/${path}`;
}

export async function discoverCloudSdkBackend(): Promise<void> {
  const namespace = config.namespace;
  if (!/^stacks-[0-9]+$/.test(namespace ?? '') || usesSdkBackend()) {
    return;
  }
  try {
    const response = await firstValueFrom(
      getBackendSrv()
        .fetch<{ status: string }>({ url: backendRoute('health', true), showErrorAlert: false })
        .pipe(timeout(2000))
    );
    if (response.data?.status === 'ok') {
      registeredCloudNamespace = namespace;
    }
  } catch {
    // The compatibility build can arrive before its router wave.
  }
}
