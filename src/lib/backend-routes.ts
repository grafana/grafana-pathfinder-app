import { firstValueFrom, timeout } from 'rxjs';
import { config, getBackendSrv } from '@grafana/runtime';
import { PLUGIN_BACKEND_URL } from '../constants';

let healthyNamespace: string | undefined;

export function usesSdkBackend(): boolean {
  return healthyNamespace !== undefined && config.namespace === healthyNamespace;
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

export async function discoverSdkBackend(): Promise<void> {
  const namespace = config.namespace;
  const toggles = config.featureToggles as Record<string, boolean> | undefined;
  const registrationEnabled =
    toggles?.['appplugins.loadAppManifest'] === true && toggles?.['appplugins.registerAPIServer'] === true;
  if (!namespace || namespace === '*' || (!/^stacks-[0-9]+$/.test(namespace) && !registrationEnabled)) {
    return;
  }
  try {
    const response = await firstValueFrom(
      getBackendSrv()
        .fetch<{ status: string }>({ url: backendRoute('health', true), showErrorAlert: false })
        .pipe(timeout(2000))
    );
    if (response.data?.status === 'ok' && config.namespace === namespace) {
      healthyNamespace = namespace;
    }
  } catch {
    // Registration flags can be enabled before the namespaced route is served.
  }
}
